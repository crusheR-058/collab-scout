// The agent loop with a scripted model and a fake Qloo: no AWS or Qloo needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, cancel, forModel, newSession, planRequest, run } from "../src/agent.mjs";
import { A, B, C, brief, entity, ok, plan, textTurn, toolTurn } from "./fixtures.mjs";

const quiet = (t) => t.mock.method(console, "error", () => {});

// A session that has already been asked once for a scan, for tests about other things.
const scanned = () => Object.assign(newSession("brief"), { askedForScan: true });

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
  const { types, events, session } = await scout(
    [
      toolTurn(["qloo_recommend", { target_type: "artist", signals: ["X"] }]),
      toolTurn(["deliver_brief", brief(["Test Artist A", "Test Artist B", "Test Artist C"])]),
    ],
    { session: scanned() },
  );
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
  assert.deepEqual(events, [{ type: "error", code: "QLOO_UNAVAILABLE", message: "Qloo is not available on this server." }]);
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
  const { types, sent } = await scout([toolTurn(["deliver_brief", one]), toolTurn(["deliver_brief", one])], { session: scanned() });
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
  if (name === "qloo_entity_tags") return ok([{ id: "urn:tag:genre:music:indie", name: " indie", type: "urn:tag:genre:music", affinity: 0.9 }]);
  if (name === "qloo_audience_demographics") {
    return ok([{ entity_id: SEED_ID, query: { age: { "25_to_29": 0.3, bad: "x" }, gender: { female: -0.1 } } }], {
      interpretation: { entity: { name: "Seed Brand" } },
    });
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
      ["qloo_entity_tags", { entities: [SEED_ID], limit: 10 }],
      ["qloo_audience_demographics", { entity: SEED_ID }],
    ],
  );
  // The field log shows the real calls the scan made.
  assert.equal(events.filter((event) => event.type === "tool_call").length, 5);

  const reply = JSON.parse(sent[2].at(-1).content[0].toolResult.content[0].text);
  assert.equal(reply.scoring_version, "1");
  assert.equal(reply.candidates[0].name, "podcast 1");
  assert.equal(reply.candidates[0].novelty, 1);

  const delivered = events.find((event) => event.type === "brief").brief;
  assert.equal(delivered.opportunities.candidates.length, 4);
  assert.deepEqual(delivered.opportunities.profile, {
    tags: { status: "ok", error: undefined, items: [{ name: "indie", type: "urn:tag:genre:music", affinity: 0.9 }] },
    // A value of the wrong shape is dropped, not shown.
    demographics: { status: "ok", error: undefined, entity: "Seed Brand", age: { "25_to_29": 0.3 }, gender: { female: -0.1 } },
  });
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

test("a plan request after a brief delivers a grounded plan and stays open", async () => {
  const session = scanned();
  await scout([toolTurn(["qloo_recommend", { target_type: "artist" }]), toolTurn(["deliver_brief", brief(["Test Artist A", "Test Artist B", "Test Artist C"])])], { session });
  answer(session, planRequest("Test Artist A"));
  const { types, events, sent } = await scout([toolTurn(["deliver_plan", plan("Test Artist A")])], { session });
  assert.deepEqual(types, ["plan", "done"]);
  const delivered = events[0].plan;
  assert.equal(delivered.verified, true);
  assert.equal(delivered.observations[0].tool, "qloo_recommend");
  assert.equal(session.pending.afterBrief, true);
  // The request the model read was written by the server.
  assert.match(sent[0].at(-1).content.at(-1).text, /Do not invent contacts, budgets/);
});

test("a garbled plan is sent back to the model", async () => {
  const { types, sent } = await scout([toolTurn(["deliver_plan", { partner: "X" }]), textTurn("")]);
  assert.deepEqual(types, ["done"]);
  assert.match(sent[1].at(-1).content[0].toolResult.content[0].text, /Plan not accepted/);
});

test("a brief and a plan in one turn: the brief wins and the plan still gets an answer", async () => {
  const { types, session } = await scout(
    [
      toolTurn(["qloo_recommend", { target_type: "artist" }]),
      toolTurn(["deliver_brief", brief(["Test Artist A", "Test Artist B", "Test Artist C"])], ["deliver_plan", plan("Test Artist A")]),
    ],
    { session: scanned() },
  );
  assert.deepEqual(types.slice(-2), ["brief", "done"]);
  const answered = session.pending.results.map((block) => block.toolResult?.content[0].text);
  assert.ok(answered.includes("Deliver one brief or plan at a time."));
});

test("a brief without a scan is sent back once for one, then accepted", async () => {
  const three = brief(["Test Artist A", "Test Artist B", "Test Artist C"]);
  const { types, sent } = await scout([
    toolTurn(["qloo_recommend", { target_type: "artist" }]),
    toolTurn(["deliver_brief", three]),
    toolTurn(["deliver_brief", three]),
  ]);
  assert.match(sent[2].at(-1).content[0].toolResult.content[0].text, /call scan_opportunities once/);
  assert.deepEqual(types.slice(-2), ["brief", "done"]);
});

test("a scan weighs the audience in the market and keeps venues in the city given", async () => {
  const { qlooCalls, events } = await scout(
    [
      toolTurn(["qloo_describe", { entity: "Seed Brand" }]),
      toolTurn(["scan_opportunities", { seeds: [SEED_ID], categories: ["artist", "place"], signal_location: " India ", venue_city: "Mumbai" }]),
      toolTurn(["deliver_brief", brief(["artist 1", "place 1", "artist 2"])]),
    ],
    { qloo: catalogue },
  );
  const [artist, place] = qlooCalls.slice(1, 3).map((call) => call.input);
  assert.deepEqual(artist, { target_type: "artist", signals: [SEED_ID], signal_location: "India" });
  assert.deepEqual(place, { target_type: "place", signals: [SEED_ID], signal_location: "India", filter_location: "Mumbai" });
  const { location, city } = events.find((event) => event.type === "brief").brief.opportunities;
  assert.deepEqual([location, city], ["India", "Mumbai"]);
});

test("the model's view of a Qloo result keeps what it acts on and drops the rest", () => {
  const view = forModel({
    schema_version: "1",
    status: "needs_input",
    summary: "Choose",
    error: { code: "X", retryable: true, recovery: "retry" },
    interpretation: { entity: { name: "Seed" } },
    query_intent: { big: true },
    execution: { duration_ms: 5 },
    provenance: { requests: [] },
    resolution: {
      provider: { name: "p" },
      issues: [{ input: "Seed", candidates: [{ id: "1", name: "Seed", description: "a cafe" }] }],
      outcomes: [{ input: "Seed", provenance: {}, alternatives: [{ id: "2", name: "Other", type: "t", description: "long" }] }],
    },
    results: [{ ...A, explainability: {}, properties: { image: { url: "https://x" }, description: "d".repeat(500), address: "1 Street" } }],
    series: [{ entity: { name: "A" }, points: [] }],
  });
  for (const gone of ["schema_version", "query_intent", "execution", "provenance"]) assert.equal(view[gone], undefined);
  assert.deepEqual(view.error, { code: "X", retryable: true, recovery: "retry" });
  assert.equal(view.resolution.issues[0].candidates[0].description, "a cafe");
  assert.deepEqual(view.resolution.outcomes[0], { input: "Seed", alternatives: [{ id: "2", name: "Other", type: "t" }] });
  assert.deepEqual(view.results[0].properties, { address: "1 Street", description: "d".repeat(300) });
  assert.equal(view.results[0].affinity, 0.9);
  assert.deepEqual(view.series, [{ entity: { name: "A" }, points: [] }]);
});

test("token and Qloo call usage is counted per session, reused calls excluded", async () => {
  const call = ["qloo_describe", { entity: "X" }];
  const usage = { inputTokens: 100, outputTokens: 7 };
  const turns = [toolTurn(call), toolTurn(call), textTurn("")].map((turn) => ({ ...turn, usage }));
  const { session } = await scout(turns);
  assert.deepEqual(session.usage, { inputTokens: 300, outputTokens: 21, qlooCalls: 1 });
});

test("a run that outlives its time limit ends instead of carrying on", async () => {
  const session = newSession("brief");
  const events = [];
  const slow = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return toolTurn(["qloo_find_tags", { query: `q${Math.random()}` }]);
  };
  for await (const event of run(session, { tools: async () => [], converse: slow, qloo: async () => ok([]), timeLimitMs: 50 })) events.push(event);
  assert.equal(events.at(-1).code, "RUN_TIMEOUT");
  assert.equal(session.done, true);
});

test("a model failure carries a code the browser and metrics can use", async (t) => {
  quiet(t);
  const { events } = await scout([], {
    converse: async () => {
      throw Object.assign(new Error("slow down"), { name: "ThrottlingException" });
    },
  });
  assert.equal(events[0].code, "MODEL_RATE_LIMIT");
});
