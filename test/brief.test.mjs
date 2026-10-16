import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBrief, checkPlan, groundBrief, groundPlan, recordEntities, recordPlaces, strings } from "../src/brief.mjs";
import { A, B, C, brief, entity, ok, plan } from "./fixtures.mjs";

test("strings reads a list sent as JSON text or as a bracketless quoted list", () => {
  assert.deepEqual(strings('["a", "b"]'), ["a", "b"]);
  assert.deepEqual(strings('"a", "b"'), ["a", "b"]);
  assert.deepEqual(strings("just one"), ["just one"]);
  assert.deepEqual(strings(["a", 2, null]), ["a"]);
  assert.deepEqual(strings(undefined), []);
});

test("checkBrief rejects a brief with missing text fields or malformed partners", () => {
  assert.match(checkBrief({}).problem, /brand must be text/);
  assert.match(checkBrief({ ...brief(["X"]), partners: [{ type: "artist" }] }).problem, /partners must be a list/);
  assert.match(checkBrief({ ...brief(["X"]), pitch: "  " }).problem, /pitch must be text/);
});

test("checkBrief rejects a pitch that swallowed the limitations, as seen from a live model", () => {
  const garbled = {
    ...brief(["X"]),
    pitch: 'Hi team,\\n\\nLet us talk.", "limitations": ["Trend data is flat", "Availability unknown"]',
    limitations: undefined,
  };
  const { problem } = checkBrief(garbled);
  assert.match(problem, /pitch contains other fields/);
  assert.match(problem, /limitations must list/);
});

test("checkBrief turns literal \\n sequences into line breaks", () => {
  const { brief: checked } = checkBrief({ ...brief(["X"]), pitch: "Hi,\\n\\nBye" });
  assert.equal(checked.pitch, "Hi,\n\nBye");
});

test("checkBrief repairs partners and limitations sent as JSON text", () => {
  const input = { ...brief(["X"]), partners: JSON.stringify(brief(["X", "Y"]).partners), limitations: '"one", "two"' };
  const { brief: checked } = checkBrief(input);
  assert.equal(checked.partners.length, 2);
  assert.deepEqual(checked.limitations, ["one", "two"]);
});

test("recordEntities keeps each call's affinity apart instead of merging them", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_rank", ok([{ ...A, affinity: 0.5 }]), { id: "rank-1" });
  recordEntities(entities, "qloo_recommend", ok([B, { ...A, affinity: 0.95 }]), { id: "rec-1", input: { signals: ["X"] } });
  const { observations } = entities.get("testartista");
  assert.deepEqual(
    observations.map(({ call, tool, affinity, position, of }) => ({ call, tool, affinity, position, of })),
    [
      { call: "rank-1", tool: "qloo_rank", affinity: 0.5, position: 1, of: 1 },
      { call: "rec-1", tool: "qloo_recommend", affinity: 0.95, position: 2, of: 2 },
    ],
  );
  assert.deepEqual(observations[1].input, { signals: ["X"] });
  assert.ok(!Number.isNaN(Date.parse(observations[1].at)));
});

test("recordEntities names the seed entities Qloo says drove a result", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_describe", ok([entity("Seed Brand", "00000000-0000-4000-8000-0000000000AA")]));
  const driven = { ...A, explainability: { "signal.interests.entities": [{ entity_id: "00000000-0000-4000-8000-0000000000aa", score: 1 }] } };
  recordEntities(entities, "qloo_recommend", ok([driven]));
  assert.deepEqual(entities.get("testartista").observations[0].drivers, ["Seed Brand"]);
});

test("recordEntities calculates a trend from Qloo's rank series, oldest to newest", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_recommend", ok([A]));
  const series = (name, ranks) => ({
    entity: { name, entityId: "id" },
    // Newest first, as Qloo sends it.
    points: ranks.map((rank, index) => ({ date: `2026-0${9 - index}-01`, population_rank: String(rank) })),
  });
  recordEntities(entities, "qloo_trends", {
    status: "ok",
    series: [series("Test Artist A", [100, 150, 300]), series("Test Artist B", [500, 400]), series("Flat Act", [9, 9]), series("One Point", [1])],
  });
  assert.deepEqual(entities.get("testartista").trend.direction, "rising");
  assert.deepEqual(entities.get("testartista").trend.from, { date: "2026-07-01", rank: 300 });
  assert.equal(entities.get("testartista").observations.length, 1);
  assert.equal(entities.get("testartistb").trend.direction, "falling");
  assert.equal(entities.get("flatact").trend.direction, "flat");
  assert.equal(entities.get("onepoint"), undefined);
});

test("recordEntities ignores tag results and malformed items", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_entity_tags", ok([{ id: "urn:tag:genre:x", name: "Tag" }, null, { name: 3 }]));
  recordEntities(entities, "qloo_recommend", { status: "error" });
  assert.equal(entities.size, 0);
});

test("recordEntities keeps only https images", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_describe", ok([{ ...A, properties: { image: { url: "javascript:alert(1)" } } }]));
  assert.equal(entities.get("testartista").image, undefined);
});

test("groundBrief takes Qloo's numbers and never the model's", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_recommend", ok([A]), { id: "rec" });
  recordEntities(entities, "qloo_describe", ok([entity("Test Artist B", B.entity_id, { popularity: 0.7 })]), { id: "desc" });
  const grounded = groundBrief(checkBrief(brief(["test artist a", "Test Artist B", "Made Up Act"])).brief, entities);
  const [a, b, madeUp] = grounded.partners;

  assert.deepEqual([a.verified, a.name, a.affinity, a.popularity], [true, "Test Artist A", 0.9, 0.4]);
  // Qloo returned B without an affinity: show none rather than the model's 0.99.
  assert.deepEqual([b.verified, b.affinity, b.popularity], [true, undefined, 0.7]);
  // Never returned by Qloo: flagged, and the model's numbers are dropped.
  assert.deepEqual([madeUp.verified, madeUp.affinity, madeUp.popularity, madeUp.observations], [false, undefined, undefined, []]);
});

test("groundBrief shows affinities from one shared call only, preferring qloo_rank", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_recommend", ok([A, B, C].map((item) => ({ ...item, affinity: 0.99 }))), { id: "rec" });
  recordEntities(entities, "qloo_rank", ok([{ ...A, affinity: 0.6 }, { ...B, affinity: 0.5 }, { ...C, affinity: 0.4 }]), { id: "rank" });
  // A later single-entity call must not replace the shared score.
  recordEntities(entities, "qloo_recommend", ok([{ ...A, affinity: 0.1 }]), { id: "late" });
  const grounded = groundBrief(checkBrief(brief(["Test Artist A", "Test Artist B", "Test Artist C"])).brief, entities);
  assert.deepEqual(grounded.partners.map((partner) => partner.affinity), [0.6, 0.5, 0.4]);
  assert.deepEqual([grounded.affinity_basis.tool, grounded.affinity_basis.covers], ["qloo_rank", 3]);
});

test("groundBrief leaves out the affinity of a partner outside the shared call", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_rank", ok([A, B]), { id: "rank" });
  recordEntities(entities, "qloo_recommend", ok([C]), { id: "rec" });
  const grounded = groundBrief(checkBrief(brief(["Test Artist A", "Test Artist B", "Test Artist C"])).brief, entities);
  assert.deepEqual(grounded.partners.map((partner) => partner.affinity), [0.9, 0.8, undefined]);
  // C's own affinity is still in its records, tied to its query.
  assert.equal(grounded.partners[2].observations[0].affinity, 0.7);
});

test("groundBrief keeps only the model's words, not fields it invents", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_recommend", ok([A]), { id: "rec" });
  const input = brief(["Test Artist A", "Made Up Act"]);
  input.partners = input.partners.map((partner) => ({ ...partner, verified: true, image: "https://example.com/x.png", trend: "rising", observations: ["fake"] }));
  const [a, madeUp] = groundBrief(checkBrief(input).brief, entities).partners;
  assert.equal(a.trend, undefined);
  assert.equal(a.image, undefined);
  assert.deepEqual([madeUp.verified, madeUp.image, madeUp.trend, madeUp.observations], [false, undefined, undefined, []]);
});

test("groundBrief checks locations against Qloo heatmap cities", () => {
  const places = new Map();
  recordPlaces(places, {
    status: "ok",
    interpretation: { entity: { name: "Test Artist A" } },
    results: [
      { query: { affinity: 0.8 }, nearest_city: { name: "Mumbai", country: "IN", distance_km: 3 } },
      { query: { affinity: 0.9 }, nearest_city: { name: "Mumbai", country: "IN", distance_km: 12 } },
      { query: { affinity: 0.7 }, nearest_city: { name: "Delhi", country: "IN", distance_km: 5 } },
      { location: {} },
    ],
  });
  const input = { ...brief(["X"]), locations: [{ name: "Mumbai (near Mumbai)", rationale: "r" }, { name: "Delhi NCR", rationale: "r" }, { name: "Goa", rationale: "r" }] };
  const { locations } = groundBrief(checkBrief(input).brief, new Map(), places);
  assert.deepEqual(locations[0].qloo, { name: "Mumbai", country: "IN", distance_km: 12, affinity: 0.9, entity: "Test Artist A" });
  assert.equal(locations[1].qloo.name, "Delhi");
  assert.equal(locations[2].qloo, undefined);
});

test("checkPlan accepts a full plan and repairs lists sent as text", () => {
  const { plan: checked } = checkPlan({ ...plan("Test Artist A"), formats: '"Pop-up", "Playlist"' });
  assert.deepEqual(checked.formats, ["Pop-up", "Playlist"]);
  assert.equal(checked.validation[0].success, "200 in two weeks");
});

test("checkPlan sends back a plan with missing parts or garbled fields", () => {
  const { problem } = checkPlan({
    ...plan("Test Artist A"),
    risks: [],
    validation: [{ test: "No measure" }],
    concept: 'Fine", "risks": ["x"]',
  });
  assert.match(problem, /risks must be a list/);
  assert.match(problem, /validation must list tests/);
  assert.match(problem, /concept contains other fields/);
});

test("groundPlan attaches Qloo's records, or flags a partner Qloo never returned", () => {
  const entities = new Map();
  recordEntities(entities, "qloo_recommend", ok([A]), { id: "rec" });
  const known = groundPlan(checkPlan(plan("test artist a")).plan, entities);
  assert.deepEqual([known.partner, known.verified, known.observations.length], ["Test Artist A", true, 1]);
  const unknown = groundPlan(checkPlan(plan("Made Up Act")).plan, entities);
  assert.deepEqual([unknown.verified, unknown.observations], [false, []]);
});
