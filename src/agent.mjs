// The scouting loop: a model on Bedrock decides which Qloo tools to call; we run
// them, pause when it asks the user something, and stop when it delivers a brief.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { checkBrief, entityLabels, groundBrief, recordEntities, strings } from "./brief.mjs";
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { callQloo } from "./qloo.mjs";
import { ASK_USER, DELIVER_BRIEF, loadTools } from "./tools.mjs";

export const MODEL = process.env.BEDROCK_MODEL_ID ?? "zai.glm-5";
const MAX_STEPS = 24;
const WRAP_UP_AT = MAX_STEPS - 4;
const MIN_PARTNERS = 3;
const WRAP_UP =
  "You are almost out of steps. Call deliver_brief now with what the results so far support, " +
  "and list anything you could not check under limitations.";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "ap-south-1" });

export const newSession = (brief) => ({
  messages: [{ role: "user", content: [{ text: brief }] }],
  pending: undefined,
  done: false,
  cancelled: false,
  // Every entity Qloo has returned in this scout, to check the brief against.
  entities: new Map(),
});

const toolResult = (toolUseId, text, isError = false) => ({
  toolResult: { toolUseId, content: [{ text }], status: isError ? "error" : "success" },
});

// Resume a session that stopped on a question or a delivered brief. A question
// asked through ask_user is answered as its tool result; a plain-text question,
// or a change the user wants to a brief, gets a text reply.
export const answer = (session, text) => {
  const { results, askId } = session.pending;
  const reply = askId ? toolResult(askId, text) : { text };
  session.messages.push({ role: "user", content: [...results, reply] });
  session.pending = undefined;
};

const runQloo = async ({ toolUseId, name, input }, entities) => {
  const envelope = await callQloo(name, input);
  recordEntities(entities, name, envelope);
  return {
    block: toolResult(toolUseId, JSON.stringify(envelope), envelope.status === "error"),
    event: {
      type: "tool_result",
      id: toolUseId,
      name,
      status: envelope.status,
      summary: envelope.summary,
      result_count: envelope.result_count,
      error: envelope.error?.code,
      requests: envelope.provenance?.requests,
    },
  };
};

// Keep only what the next request may replay: some models reject their own
// reasoning blocks or blank text when it is sent back.
// A garbled tool name would also be rejected, so rename it and let the loop
// answer it as an unknown tool.
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const replayable = (content) =>
  content
    .filter((block) => block.toolUse || (block.text && block.text.trim()))
    .map((block) =>
      block.toolUse && !VALID_TOOL_NAME.test(block.toolUse.name)
        ? { toolUse: { ...block.toolUse, name: "unreadable_tool", input: {} } }
        : block,
    );

// Yields events for the UI until the session pauses on a question or finishes.
export async function* run(session) {
  const tools = await loadTools();

  for (let step = 0; step < MAX_STEPS; step += 1) {
    // The visitor pressed Stop or left: spend no more Qloo quota or tokens.
    if (session.cancelled) {
      session.done = true;
      return;
    }
    let response;
    try {
      response = await client.send(
        new ConverseCommand({
          modelId: MODEL,
          system: [{ text: SYSTEM_PROMPT }],
          toolConfig: { tools },
          messages: session.messages,
          inferenceConfig: { maxTokens: 8000 },
        }),
      );
    } catch (error) {
      yield { type: "error", message: `Model request failed: ${error.message}` };
      return;
    }

    const content = replayable(response.output.message.content);
    if (content.length) session.messages.push({ role: "assistant", content });
    const said = content
      .filter((block) => block.text)
      .map((block) => block.text.trim())
      .join("\n\n");

    if (response.stopReason !== "tool_use") {
      if (response.stopReason !== "end_turn") {
        session.done = true;
        yield { type: "error", message: `The model stopped early (${response.stopReason}).` };
        return;
      }
      // Some models ask in plain text instead of calling ask_user. Keep the
      // session open so the user can reply.
      if (said) {
        session.pending = { results: [] };
        yield { type: "question", question: said, options: [] };
        return;
      }
      session.done = true;
      yield { type: "done" };
      return;
    }
    if (said) yield { type: "text", text: said };

    const calls = content.filter((block) => block.toolUse).map((block) => block.toolUse);
    const [ask, ...extraAsks] = calls.filter((call) => call.name === ASK_USER);
    const briefCall = calls.find((call) => call.name === DELIVER_BRIEF);
    let { brief, problem } = briefCall ? checkBrief(briefCall.input) : {};
    // Push back once on a thin shortlist; accept it if the model insists.
    if (brief && brief.partners.length < MIN_PARTNERS && !session.askedForMore) {
      session.askedForMore = true;
      problem = `Brief not accepted: it names ${brief.partners.length} partner. Give the three to five strongest, or deliver again as it is if Qloo returned no more and say so under limitations.`;
      brief = undefined;
    }
    const qlooCalls = calls.filter((call) => call.name.startsWith("qloo_"));
    const unknown = calls.filter(
      (call) => ![ASK_USER, DELIVER_BRIEF].includes(call.name) && !call.name.startsWith("qloo_"),
    );

    for (const call of qlooCalls) {
      yield {
        type: "tool_call",
        id: call.toolUseId,
        name: call.name,
        input: call.input,
        labels: entityLabels(session.entities, call.input),
      };
    }
    const outcomes = await Promise.all(qlooCalls.map((call) => runQloo(call, session.entities)));
    for (const { event } of outcomes) yield event;

    const results = [
      ...outcomes.map(({ block }) => block),
      ...extraAsks.map((call) => toolResult(call.toolUseId, "Ask one question at a time.", true)),
      ...unknown.map((call) => toolResult(call.toolUseId, `No tool named ${call.name}.`, true)),
    ];
    if (brief) {
      results.push(toolResult(briefCall.toolUseId, "Brief delivered."));
      if (ask) results.push(toolResult(ask.toolUseId, "The brief is already delivered.", true));
      // Stay open so the user can ask for a change to this brief.
      session.pending = { results, afterBrief: true };
      yield { type: "brief", brief: groundBrief(brief, session.entities) };
      yield { type: "done" };
      return;
    }
    if (briefCall) results.push(toolResult(briefCall.toolUseId, problem, true));

    if (ask) {
      session.pending = { results, askId: ask.toolUseId };
      // The model sometimes sends the options as a JSON string, or no question text.
      const question = String(ask.input.question ?? "").trim() || said || "The scout needs more detail.";
      yield { type: "question", question, options: strings(ask.input.options) };
      return;
    }

    if (step === WRAP_UP_AT) results.push({ text: WRAP_UP });
    session.messages.push({ role: "user", content: results });
  }

  yield { type: "error", message: "Stopped after reaching the step limit without a brief." };
}
