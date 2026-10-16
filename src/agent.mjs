// The scouting loop: a model on Bedrock decides which Qloo tools to call; we run
// them, pause when it asks the user something, and stop when it delivers a brief.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { checkBrief, checkPlan, entityLabels, groundBrief, groundPlan, profileFrom, recordEntities, recordPlaces, strings } from "./brief.mjs";
import { CATEGORIES, MAX_CATEGORIES, PREFERENCES, scoreScan } from "../public/js/opportunities.js";
import { log } from "./log.mjs";
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { callQloo } from "./qloo.mjs";
import { ASK_USER, DELIVER_BRIEF, DELIVER_PLAN, SCAN_OPPORTUNITIES, loadTools } from "./tools.mjs";

export const MODEL = process.env.BEDROCK_MODEL_ID ?? "zai.glm-5";
const MAX_STEPS = 24;
const WRAP_UP_AT = MAX_STEPS - 4;
const MIN_PARTNERS = 3;
// Spend limits for one run (a start, an answer or a revision).
const MAX_QLOO_CALLS_PER_RUN = 30;
const MAX_QLOO_CALLS_PER_TURN = 8;
const MAX_SEEDS = 5;
// Candidates the model reads back from a scan; the brief shows them all.
const SCAN_ROWS_FOR_MODEL = 15;
const MODEL_TIMEOUT_MS = 120 * 1000;
// Steps and calls are bounded, but a run also gets a wall-clock limit.
const RUN_TIMEOUT_MS = 8 * 60 * 1000;
const WRAP_UP =
  "You are almost out of steps. Call deliver_brief now with what the results so far support, " +
  "and list anything you could not check under limitations.";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "ap-south-1" });

const converse = (input, abortSignal) => client.send(new ConverseCommand(input), { abortSignal });

export const newSession = (brief) => ({
  messages: [{ role: "user", content: [{ text: brief }] }],
  pending: undefined,
  done: false,
  cancelled: false,
  controller: new AbortController(),
  // Every entity Qloo has returned in this scout, with each call that returned
  // it, and the named heatmap cells: the evidence the brief is checked against.
  entities: new Map(),
  places: new Map(),
  // Successful Qloo results by tool and input, so a repeated call costs nothing.
  cache: new Map(),
  // Model tokens as Bedrock reports them, and Qloo requests actually sent.
  usage: { inputTokens: 0, outputTokens: 0, qlooCalls: 0 },
});

// The visitor pressed Stop or left: abort the model and Qloo calls in flight.
export const cancel = (session) => {
  session.cancelled = true;
  session.controller.abort();
};

const toolResult = (toolUseId, text, isError = false) => ({
  toolResult: { toolUseId, content: [{ text }], status: isError ? "error" : "success" },
});

const refusal = (code, summary) => ({ status: "error", summary, error: { code, retryable: false } });

// Provider error text can carry account details, so the browser gets a code
// and a plain message only; the server log keeps the provider's error name.
const modelFailure = (error) => {
  if (error.name === "TimeoutError") return { code: "MODEL_TIMEOUT", message: "The model took too long to answer. Try again." };
  if (error.name === "ThrottlingException") return { code: "MODEL_RATE_LIMIT", message: "The model is busy right now. Try again in a minute." };
  if (error.name === "AccessDeniedException") {
    return { code: "MODEL_AUTH", message: "This server is not allowed to use the model. Check its Bedrock access." };
  }
  if (error.name === "ValidationException") return { code: "MODEL_REJECTED", message: "The model rejected the request." };
  return { code: "MODEL_ERROR", message: `The model request failed (${error.name ?? "unknown error"}).` };
};

// What a request for a partnership plan says to the model. Written here, not
// by the browser, so the rules for a plan cannot be edited from outside.
export const planRequest = (partner, note) =>
  [
    `Build a partnership plan for ${partner} and deliver it with deliver_plan.`,
    "Base the fit on what Qloo returned in this scout about this partner and the user's audience; make further Qloo calls only if the plan needs them.",
    "Do not invent contacts, budgets, existing relationships, endorsements, sales or revenue forecasts.",
    "Success measures are things to measure in a small test, not predictions.",
    note && `The user adds: ${note}`,
  ]
    .filter(Boolean)
    .join(" ");

// Resume a session that stopped on a question or a delivered brief. A question
// asked through ask_user is answered as its tool result; a plain-text question,
// or a change the user wants to a brief, gets a text reply.
export const answer = (session, text) => {
  const { results, askId } = session.pending;
  const reply = askId ? toolResult(askId, text) : { text };
  session.messages.push({ role: "user", content: [...results, reply] });
  session.pending = undefined;
};

const callKey = ({ name, input }) => `${name} ${JSON.stringify(input)}`;

// What the model reads of a Qloo result: the data, plus what it needs to act on
// a failure or an ambiguous match. Request logs, timings, images and long
// descriptions stay with the app; on live samples this is 58% smaller, and the
// whole conversation is replayed every step.
const compactResult = ({ explainability, properties, ...item }) => {
  if (!properties) return item;
  const { image, description, ...rest } = properties;
  return { ...item, properties: { ...rest, ...(description && !rest.short_description && { description: description.slice(0, 300) }) } };
};

export const forModel = ({ query_intent, execution, provenance, explainability, schema_version, ...envelope }) => ({
  ...envelope,
  ...(envelope.resolution && {
    resolution: {
      issues: envelope.resolution.issues,
      outcomes: envelope.resolution.outcomes?.map(({ provenance: _, alternatives, ...outcome }) => ({
        ...outcome,
        alternatives: alternatives?.map(({ id, name, type }) => ({ id, name, type })),
      })),
    },
  }),
  ...(Array.isArray(envelope.results) && { results: envelope.results.map(compactResult) }),
});

// Every step replays the whole conversation, so Qloo results from before the
// latest turn, which the model has already read, lose the middle of trend
// series and the alternatives of names that resolved. Unresolved names keep
// theirs, since the user may still be choosing, and descriptions stay, since
// without them the model looked partners up again. The evidence ledger keeps
// every result in full for grounding.
const FULL_TURNS = 1;

const shrinkEnvelope = ({ resolution, ...envelope }) => ({
  ...envelope,
  ...(resolution && {
    resolution: {
      ...resolution,
      outcomes: resolution.outcomes?.map((outcome) =>
        outcome.status === "resolved"
          ? {
              input: outcome.input,
              status: outcome.status,
              ...(outcome.selected && { selected: { id: outcome.selected.id, name: outcome.selected.name, type: outcome.selected.type } }),
            }
          : outcome,
      ),
    },
  }),
  ...(Array.isArray(envelope.series) && {
    series: envelope.series.map(({ points, ...series }) => {
      if (!Array.isArray(points) || points.length <= 2) return { ...series, points };
      const sorted = points.toSorted((a, b) => String(a?.date).localeCompare(String(b?.date)));
      return { ...series, points: [sorted[0], sorted.at(-1)], point_count: points.length };
    }),
  }),
});

export const shrinkOldResults = (messages) => {
  const turns = messages.filter((message) => message.role === "user");
  for (const { content } of turns.slice(0, -FULL_TURNS)) {
    for (const block of content) {
      const part = block.toolResult?.content?.[0];
      if (!part?.text?.startsWith("{")) continue;
      try {
        part.text = JSON.stringify(shrinkEnvelope(JSON.parse(part.text)));
      } catch {
        // Not JSON after all: leave it as sent.
      }
    }
  }
};

// `known` is a result already in hand: an earlier identical call, or a refusal.
const runQloo = async ({ toolUseId, name, input }, known, session, qloo) => {
  if (!known) session.usage.qlooCalls += 1;
  const envelope = known ?? (await qloo(name, input, session.controller.signal));
  // A reused result was recorded when it first arrived.
  if (!known) {
    if (envelope.status !== "error") session.cache.set(callKey({ name, input }), envelope);
    const labels = entityLabels(session.entities, input);
    recordEntities(session.entities, name, envelope, { id: toolUseId, input, labels });
    if (name === "qloo_where_popular") recordPlaces(session.places, envelope);
  }
  return {
    envelope,
    block: toolResult(toolUseId, JSON.stringify(forModel(envelope)), envelope.status === "error"),
    event: {
      type: "tool_result",
      id: toolUseId,
      name,
      status: envelope.status,
      summary: envelope.summary,
      result_count: envelope.result_count,
      error: envelope.error?.code,
      retries: envelope.retries,
      requests: envelope.provenance?.requests,
    },
  };
};

// A scan becomes one qloo_recommend job per category, plus the seeds' tags and
// the first seed's demographics for the audience profile. Seeds must be
// entities Qloo already returned in this scout, so a scan never starts from a guess.
const planScan = ({ toolUseId, input }, session) => {
  const ids = strings(input.seeds).map((id) => id.trim().toUpperCase());
  const seeds = ids.map((id) => [...session.entities.values()].find((entity) => String(entity.id).toUpperCase() === id));
  const categories = [...new Set(strings(input.categories))];
  const problems = [];
  if (!ids.length || ids.length > MAX_SEEDS) problems.push(`seeds must list 1 to ${MAX_SEEDS} entity IDs`);
  else if (seeds.some((seed) => !seed)) {
    problems.push("every seed must be the ID of an entity Qloo returned in this scout; resolve names with qloo_describe first");
  }
  if (!categories.length || categories.length > MAX_CATEGORIES || categories.some((category) => !CATEGORIES.includes(category))) {
    problems.push(`categories must list 1 to ${MAX_CATEGORIES} of ${CATEGORIES.join(", ")}`);
  }
  if (problems.length) return { problem: `Scan not run: ${problems.join("; ")}.` };

  const text = (value) => (typeof value === "string" ? value.trim().slice(0, 100) : "");
  const location = text(input.signal_location);
  const city = text(input.venue_city);
  return {
    seeds,
    location: location || undefined,
    city: city || undefined,
    prefer: PREFERENCES.includes(input.prefer) ? input.prefer : "either",
    jobs: [
      ...categories.map((category) => ({
        toolUseId: `${toolUseId}-${category}`,
        name: "qloo_recommend",
        input: {
          target_type: category,
          signals: seeds.map((seed) => seed.id),
          // signal_location weighs the audience but does not restrict results, so
          // venues need a city filter to be in the market. A country-wide venue
          // filter timed out in testing, hence a city only.
          ...(location && { signal_location: location }),
          ...(city && category === "place" && { filter_location: city }),
        },
        category,
      })),
      { toolUseId: `${toolUseId}-tags`, name: "qloo_entity_tags", input: { entities: seeds.map((seed) => seed.id), limit: 10 }, part: "tags" },
      { toolUseId: `${toolUseId}-audience`, name: "qloo_audience_demographics", input: { entity: seeds[0].id }, part: "demographics" },
    ],
  };
};

// What the model reads back: the top of the table, without our bookkeeping.
const scanForModel = (scan) => ({
  scoring_version: scan.version,
  prefer: scan.prefer,
  weights: scan.weights,
  categories: scan.categories,
  audience: scan.profile,
  note: "Heuristic scores that rank within this scan only. The user sees the full table in the brief.",
  candidates: scan.candidates
    .slice(0, SCAN_ROWS_FOR_MODEL)
    .map(({ id, name, category, position, of, popularity, fit, size, novelty, score, missing }) => ({
      id, name, category, position, of, popularity, fit, size, novelty, score, missing,
    })),
});

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
// Tests pass their own `converse`, `qloo` and `tools` to run without AWS or Qloo.
export async function* run(
  session,
  { converse: send = converse, qloo = callQloo, tools: listTools = loadTools, timeLimitMs = RUN_TIMEOUT_MS } = {},
) {
  let tools;
  try {
    tools = await listTools();
  } catch (error) {
    log("error", "qloo_unavailable", { reason: error.message });
    session.done = true;
    yield { type: "error", code: "QLOO_UNAVAILABLE", message: "Qloo is not available on this server." };
    return;
  }
  let spent = 0;
  const deadline = Date.now() + timeLimitMs;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    // The visitor pressed Stop or left: spend no more Qloo quota or tokens.
    if (session.cancelled) {
      session.done = true;
      return;
    }
    if (Date.now() > deadline) {
      session.done = true;
      yield { type: "error", code: "RUN_TIMEOUT", message: "The scout ran out of time without a brief. Try a narrower brief." };
      return;
    }
    shrinkOldResults(session.messages);
    let response;
    const timeout = AbortSignal.timeout(MODEL_TIMEOUT_MS);
    try {
      response = await send(
        {
          modelId: MODEL,
          system: [{ text: SYSTEM_PROMPT }],
          toolConfig: { tools },
          messages: session.messages,
          inferenceConfig: { maxTokens: 8000 },
        },
        AbortSignal.any([session.controller.signal, timeout]),
      );
    } catch (error) {
      session.done = true;
      if (session.cancelled) return;
      const failure = modelFailure(timeout.aborted ? { name: "TimeoutError" } : error);
      log("error", "model_failed", { code: failure.code, provider_error: error.name, reason: error.message });
      yield { type: "error", ...failure };
      return;
    }

    session.usage.inputTokens += response.usage?.inputTokens ?? 0;
    session.usage.outputTokens += response.usage?.outputTokens ?? 0;
    const content = replayable(response.output.message.content);
    if (content.length) session.messages.push({ role: "assistant", content });
    const said = content
      .filter((block) => block.text)
      .map((block) => block.text.trim())
      .join("\n\n");

    if (response.stopReason !== "tool_use") {
      if (response.stopReason !== "end_turn") {
        session.done = true;
        yield { type: "error", code: "MODEL_STOPPED", message: `The model stopped early (${response.stopReason}).` };
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
    // One delivery per turn: a brief wins over a plan, and every other
    // delivery call still gets an answer, as Bedrock requires.
    const deliveries = calls.filter((call) => call.name === DELIVER_BRIEF || call.name === DELIVER_PLAN);
    const briefCall = deliveries.find((call) => call.name === DELIVER_BRIEF);
    const planCall = !briefCall && deliveries.find((call) => call.name === DELIVER_PLAN);
    const extraDeliveries = deliveries.filter((call) => call !== briefCall && call !== planCall);
    const { plan, problem: planProblem } = planCall ? checkPlan(planCall.input) : {};
    let { brief, problem } = briefCall ? checkBrief(briefCall.input) : {};
    // Push back once on a thin shortlist; accept it if the model insists.
    if (brief && brief.partners.length < MIN_PARTNERS && !session.askedForMore) {
      session.askedForMore = true;
      problem = `Brief not accepted: it names ${brief.partners.length} partner. Give the three to five strongest, or deliver again as it is if Qloo returned no more and say so under limitations.`;
      brief = undefined;
    }
    // The audience profile and cross-category table come from a scan, so ask
    // for one once before accepting a brief without it.
    if (brief && !session.scan && !session.askedForScan) {
      session.askedForScan = true;
      problem =
        "Brief not accepted yet: call scan_opportunities once with the resolved seed entity IDs, the partner type the user wants " +
        "and two to four other categories, so the user gets the audience profile and the cross-category table. Then deliver the brief again.";
      brief = undefined;
    }
    const scans = calls.filter((call) => call.name === SCAN_OPPORTUNITIES).map((call) => ({ call, ...planScan(call, session) }));
    const ownCalls = calls.filter((call) => call.name.startsWith("qloo_"));
    // Scan jobs run like the model's own Qloo calls: same budget, cache, log and evidence.
    const qlooCalls = [...ownCalls, ...scans.flatMap((scan) => scan.jobs ?? [])];
    const unknown = calls.filter(
      (call) => ![ASK_USER, DELIVER_BRIEF, DELIVER_PLAN, SCAN_OPPORTUNITIES].includes(call.name) && !call.name.startsWith("qloo_"),
    );

    // A refused call is answered to the model only; the log shows calls that ran.
    const known = qlooCalls.map((call, index) => {
      const earlier = session.cache.get(callKey(call));
      if (index >= MAX_QLOO_CALLS_PER_TURN) {
        return refusal("TURN_LIMIT", `Not run: send at most ${MAX_QLOO_CALLS_PER_TURN} Qloo calls in one turn.`);
      }
      if (earlier) return earlier;
      if (spent >= MAX_QLOO_CALLS_PER_RUN) {
        return refusal("BUDGET", "Not run: the Qloo call budget is used up. Deliver the brief with what you have and say what you could not check.");
      }
      spent += 1;
      return undefined;
    });
    for (const [index, call] of qlooCalls.entries()) {
      if (known[index]?.status === "error") continue;
      yield {
        type: "tool_call",
        id: call.toolUseId,
        name: call.name,
        input: call.input,
        labels: entityLabels(session.entities, call.input),
        reused: Boolean(known[index]),
      };
    }
    const outcomes = await Promise.all(qlooCalls.map((call, index) => runQloo(call, known[index], session, qloo)));
    for (const [index, { event }] of outcomes.entries()) {
      if (known[index]?.status !== "error") yield event;
    }

    const scanResults = [];
    for (const scan of scans) {
      if (scan.problem) {
        scanResults.push(toolResult(scan.call.toolUseId, scan.problem, true));
        continue;
      }
      const envelope = (job) => outcomes[qlooCalls.indexOf(job)].envelope;
      const part = (name) => envelope(scan.jobs.find((job) => job.part === name));
      session.scan = {
        ...scoreScan({
          calls: scan.jobs.filter((job) => job.category).map((job) => ({ category: job.category, envelope: envelope(job) })),
          seeds: scan.seeds,
          prefer: scan.prefer,
        }),
        profile: profileFrom(part("tags"), part("demographics")),
        location: scan.location,
        city: scan.city,
        at: new Date().toISOString(),
      };
      scanResults.push(toolResult(scan.call.toolUseId, JSON.stringify(scanForModel(session.scan))));
      yield { type: "text", text: `Scored ${session.scan.candidates.length} candidates across ${session.scan.categories.length} categories.` };
    }

    const results = [
      ...outcomes.slice(0, ownCalls.length).map(({ block }) => block),
      ...scanResults,
      ...extraAsks.map((call) => toolResult(call.toolUseId, "Ask one question at a time.", true)),
      ...extraDeliveries.map((call) => toolResult(call.toolUseId, "Deliver one brief or plan at a time.", true)),
      ...unknown.map((call) => toolResult(call.toolUseId, `No tool named ${call.name}.`, true)),
    ];
    if (brief) {
      results.push(toolResult(briefCall.toolUseId, "Brief delivered."));
      if (ask) results.push(toolResult(ask.toolUseId, "The brief is already delivered.", true));
      // Stay open so the user can ask for a change to this brief.
      session.pending = { results, afterBrief: true };
      yield { type: "brief", brief: { ...groundBrief(brief, session.entities, session.places), opportunities: session.scan } };
      yield { type: "done" };
      return;
    }
    if (briefCall) results.push(toolResult(briefCall.toolUseId, problem, true));
    if (plan) {
      results.push(toolResult(planCall.toolUseId, "Plan delivered."));
      if (ask) results.push(toolResult(ask.toolUseId, "The plan is already delivered.", true));
      // Stay open for another plan or a change to the brief.
      session.pending = { results, afterBrief: true };
      yield { type: "plan", plan: groundPlan(plan, session.entities) };
      yield { type: "done" };
      return;
    }
    if (planCall) results.push(toolResult(planCall.toolUseId, planProblem, true));

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

  session.done = true;
  yield { type: "error", code: "STEP_LIMIT", message: "Stopped after reaching the step limit without a brief." };
}
