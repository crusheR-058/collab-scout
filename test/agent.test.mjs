// The agent loop with a scripted model and a fake Qloo: no AWS or Qloo needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, cancel, newSession, run } from "../src/agent.mjs";
import { A, B, C, brief, entity, ok, textTurn, toolTurn } from "./fixtures.mjs";

const quiet = (t) => t.mock.method(console, "error", () => {});

// Runs one scout; `turns` are the model's replies in order.
const scout = async (turns, { session = newSession("brief"), qloo, converse } = {}) => {
  const queue = [...turns];
  const sent = [];
  const qlooCalls = [];
  const events = [];
  const deps = {
    tools: async () => [],
    converse: converse ?? (async (input) => (sent.push(structuredClone(input.messages)), queue.shift() ?? textTurn(""))),
    qloo: async (name, input, signal) => {
      qlooCalls.push({ name, input, signal });
      return qloo ? qloo(name, input) : ok([A, B, C]);
    },
  };
  for await (const event of run(session, deps)) events.push(event);
  return { events, qlooCalls, sent, session, types: events.map((event) => event.type) };
};

test("a scout runs Qloo calls and delivers a grounded brief", async () => {
  const { types, events, session } = await scout([
    toolTurn(["qloo_recommend", { target_type: "artist", signals: ["X"] }]),
    toolTurn(["deliver_brief", brief(["Test Artist A", "Test Artist B", "Test Artist C"])]),
  ]);
  assert.deepEqual(types, ["tool_call", "tool_result", "brief", "done"]);
  const delivered = events.find((event) => event.type === "brief").brief;
  assert.equal(delivered.partners[0].affinity, 0.9);
  assert.ok(delivered.partners.every((partner) => partner.verified));
  // Kept open for a revision.
  assert.equal(session.pending.afterBrief, true);
  assert.equal(session.done, false);
});

test("an identical repeated Qloo call reuses the earlier result", async () => {
  const call = ["qloo_recommend", { target_type: "artist", signals: ["X"] }];
  const { qlooCalls, events, session } = await scout([toolTurn(call), toolTurn(call), textTurn("")]);
  assert.equal(qlooCalls.length, 1);
  // Evidence is recorded once, when the result first arrived.
  assert.equal(session.entities.get("testartista").observations.length, 1);
  assert.deepEqual(
    events.filter((event) => event.type === "tool_call").map((event) => event.reused),
    [false, true],
  );
});

test("a failed Qloo call is not cached, so a retry reaches Qloo", async () => {
  const call = ["qloo_describe", { entity: "X" }];
  let attempts = 0;
  const { qlooCalls } = await scout([toolTurn(call), toolTurn(call), textTurn("")], {
    qloo: () => (attempts++ ? ok([A]) : { status: "error", summary: "down", error: { code: "TRANSPORT", retryable: true } }),
  });
  assert.equal(qlooCalls.length, 2);
});

test("more than eight Qloo calls in one turn are refused, not run", async () => {
  const calls = Array.from({ length: 10 }, (_, index) => ["qloo_describe", { entity: `E${index}` }]);
  const { qlooCalls, events, sent } = await scout([toolTurn(...calls), textTurn("")]);
  assert.equal(qlooCalls.length, 8);
  assert.equal(events.filter((event) => event.type === "tool_call").length, 8);
  const replies = sent[1].at(-1).content.map((block) => block.toolResult);
  assert.equal(replies.filter((reply) => reply.status === "error").length, 2);
  assert.match(replies.at(-1).content[0].text, /TURN_LIMIT/);
});

test("a run stops calling Qloo once its budget is spent", async () => {
  const turns = Array.from({ length: 5 }, (_, turn) =>
    toolTurn(...Array.from({ length: 8 }, (_, index) => ["qloo_describe", { entity: `E${turn}-${index}` }])),
  );
  const { qlooCalls, sent } = await scout([...turns, textTurn("")]);
  assert.equal(qlooCalls.length, 30);
  assert.match(JSON.stringify(sent.at(-1).at(-1)), /BUDGET/);
});

test("a model failure ends the scout with the error name only", async (t) => {
  quiet(t);
  const secret = Object.assign(new Error("User: arn:aws:iam::123456789012:user/x is not authorized"), {
    name: "AccessDeniedException",
  });
  const { events, session } = await scout([], {
    converse: async () => {
      throw secret;
    },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "error");
  assert.doesNotMatch(events[0].message, /arn:aws/);
  assert.equal(session.done, true);
});

test("Qloo being unavailable ends the scout with a plain message", async (t) => {
  quiet(t);
  const session = newSession("brief");
  const events = [];
  for await (const event of run(session, {
    tools: async () => {
      throw new Error("spawn qloo ENOENT");
    },
  })) {
    events.push(event);
  }
  assert.deepEqual(events, [{ type: "error", message: "Qloo is not available on this server." }]);
});

test("cancelling aborts the model call in flight and ends quietly", async () => {
  const session = newSession("brief");
  const pending = scout([], {
    session,
    converse: (_input, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  setTimeout(() => cancel(session), 10);
  const { events } = await pending;
  assert.deepEqual(events, []);
  assert.equal(session.done, true);
});

test("a cancelled scout makes no further Qloo calls", async () => {
  const session = newSession("brief");
  cancel(session);
  const { qlooCalls, events } = await scout([toolTurn(["qloo_describe", { entity: "X" }])], { session });
  assert.equal(qlooCalls.length, 0);
  assert.deepEqual(events, []);
});

test("the Qloo call gets the session's abort signal", async () => {
  const session = newSession("brief");
  const { qlooCalls } = await scout([toolTurn(["qloo_describe", { entity: "X" }]), textTurn("")], { session });
  assert.equal(qlooCalls[0].signal, session.controller.signal);
});

test("a question pauses the scout and an answer resumes it", async () => {
  const session = newSession("brief");
  const first = await scout([toolTurn(["ask_user", { question: "Which one?", options: '"A", "B"' }])], { session });
  assert.deepEqual(first.events, [{ type: "question", question: "Which one?", options: ["A", "B"] }]);

  answer(session, "A");
  const second = await scout([textTurn("")], { session });
  assert.deepEqual(second.types, ["done"]);
  // The answer went back as the ask_user tool result.
  assert.equal(second.sent[0].at(-1).content[0].toolResult.content[0].text, "A");
});

test("a thin shortlist is pushed back once, then accepted", async () => {
  const one = brief(["Test Artist A"]);
  const { types, sent } = await scout([toolTurn(["deliver_brief", one]), toolTurn(["deliver_brief", one])]);
  assert.match(JSON.stringify(sent[1].at(-1)), /Brief not accepted/);
  assert.deepEqual(types, ["brief", "done"]);
});

test("the step limit ends the scout instead of looping", async () => {
  const turns = Array.from({ length: 30 }, (_, index) => toolTurn(["qloo_find_tags", { query: `q${index}` }]));
  const { events, session } = await scout(turns, { qloo: () => ok([]) });
  assert.equal(events.at(-1).type, "error");
  assert.match(events.at(-1).message, /step limit/);
  assert.equal(session.done, true);
});

test("an unknown or garbled tool name is answered as an error", async () => {
  const { sent } = await scout([toolTurn(["no such tool!", {}]), textTurn("")]);
  const replay = sent[1];
  assert.equal(replay.at(-2).content[0].toolUse.name, "unreadable_tool");
  assert.equal(replay.at(-1).content[0].toolResult.status, "error");
});

// A fake Qloo that resolves a seed brand and returns two candidates per category.
const SEED_ID = "00000000-0000-4000-8000-0000000000AA";
const catalogue = (name, input) => {
  if (name === "qloo_describe") {
    // Real describe results carry no subtype; the type is in the interpretation.
    return ok([entity("Seed Brand", SEED_ID, { subtype: undefined })], { interpretation: { entity: { type: "urn:entity:brand" } } });
  }
  const type = input.target_type;
  return ok([1, 2].map((n) => entity(`${type} ${n}`, `00000000-0000-4000-8000-${type.length}${n}`.padEnd(36, "0"), { subtype: `urn:entity:${type}`, popularity: n / 2 })));
};

test("a scan refuses seeds that Qloo has not returned in this scout", async () => {
  const { qlooCalls, sent } = await scout(
    [toolTurn(["scan_opportunities", { seeds: [SEED_ID], categories: ["artist"] }]), textTurn("")],
    { qloo: catalogue },
  );
  assert.equal(qlooCalls.length, 0);
  const reply = sent[1].at(-1).content[0].toolResult;
  assert.equal(reply.status, "error");
  assert.match(reply.content[0].text, /resolve names with qloo_describe first/);
});

test("a scan rejects unknown or too many categories", async () => {
  const many = ["artist", "book", "brand", "movie", "person", "place", "podcast"];
  for (const categories of [["spaceship"], many, []]) {
    const { qlooCalls, sent } = await scout(
      [toolTurn(["qloo_describe", { entity: "Seed Brand" }]), toolTurn(["scan_opportunities", { seeds: [SEED_ID], categories }]), textTurn("")],
      { qloo: catalogue },
    );
    assert.equal(qlooCalls.length, 1);
    assert.match(sent[2].at(-1).content[0].toolResult.content[0].text, /categories must list 1 to 6/);
  }
});

test("a scan runs one logged recommend per category and returns a scored table", async () => {
  const { qlooCalls, events, sent } = await scout(
    [
      toolTurn(["qloo_describe", { entity: "Seed Brand" }]),
      toolTurn(["scan_opportunities", { seeds: [SEED_ID.toLowerCase()], categories: ["brand", "podcast"], prefer: "emerging" }]),
      toolTurn(["deliver_brief", brief(["podcast 1", "brand 1", "podcast 2"])]),
    ],
    { qloo: catalogue },
  );
  assert.deepEqual(
    qlooCalls.slice(1).map(({ name, input }) => [name, input]),
    [
      ["qloo_recommend", { target_type: "brand", signals: [SEED_ID] }],
      ["qloo_recommend", { target_type: "podcast", signals: [SEED_ID] }],
    ],
  );
  // The field log shows the real calls the scan made.
  assert.equal(events.filter((event) => event.type === "tool_call").length, 3);

  const reply = JSON.parse(sent[2].at(-1).content[0].toolResult.content[0].text);
  assert.equal(reply.scoring_version, "1");
  assert.equal(reply.candidates[0].name, "podcast 1");
  assert.equal(reply.candidates[0].novelty, 1);

  const delivered = events.find((event) => event.type === "brief").brief;
  assert.equal(delivered.opportunities.candidates.length, 4);
  assert.equal(delivered.opportunities.prefer, "emerging");
  // Scan results are evidence like any other call.
  assert.equal(delivered.partners[0].observations[0].tool, "qloo_recommend");
});

test("scan calls count toward the per-turn limit", async () => {
  const describes = Array.from({ length: 6 }, (_, index) => ["qloo_describe", { entity: `E${index}` }]);
  const { qlooCalls, sent } = await scout(
    [
      toolTurn(["qloo_describe", { entity: "Seed Brand" }]),
      toolTurn(...describes, ["scan_opportunities", { seeds: [SEED_ID], categories: ["artist", "book", "movie"] }]),
      textTurn(""),
    ],
    { qloo: catalogue },
  );
  assert.equal(qlooCalls.length, 1 + 8);
  const scan = JSON.parse(sent[2].at(-1).content.at(-1).toolResult.content[0].text);
  assert.equal(scan.categories.at(-1).error, "TURN_LIMIT");
});
