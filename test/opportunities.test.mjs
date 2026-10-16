import assert from "node:assert/strict";
import { test } from "node:test";
import { rankCandidates, scoreScan } from "../public/js/opportunities.js";
import { entity, ok } from "./fixtures.mjs";

const SEED = { id: "00000000-0000-4000-8000-0000000000AA", name: "Seed Brand", category: "urn:entity:brand" };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (name, n, category, extra) => entity(name, id(n), { subtype: `urn:entity:${category}`, ...extra });

const brands = { category: "brand", envelope: ok([item("Brand One", 1, "brand", { popularity: 0.99 }), item("Brand Two", 2, "brand", { popularity: 0.9 })]) };
const podcasts = { category: "podcast", envelope: ok([item("Pod One", 3, "podcast", { popularity: 0.95 }), item("Pod Two", 4, "podcast", { popularity: 0.8 })]) };

test("fit comes from Qloo's order within each call, not raw affinity across calls", () => {
  const scan = scoreScan({
    calls: [
      { category: "brand", envelope: ok([item("High Affinity Brand", 1, "brand", { affinity: 0.99 })]) },
      { category: "podcast", envelope: ok([item("Low Affinity Podcast", 2, "podcast", { affinity: 0.4 })]) },
    ],
    seeds: [SEED],
  });
  // Both are first in their own call, so both fit fully.
  assert.deepEqual(scan.candidates.map((candidate) => candidate.fit), [1, 1]);
});

test("a category other than the seed's scores novelty", () => {
  const scan = scoreScan({ calls: [brands, podcasts], seeds: [SEED] });
  const byName = Object.fromEntries(scan.candidates.map((candidate) => [candidate.name, candidate]));
  assert.equal(byName["Brand One"].novelty, 0);
  assert.equal(byName["Pod One"].novelty, 1);
  // Same position, more novel: the podcast ranks first.
  assert.equal(scan.candidates[0].name, "Pod One");
});

test("'emerging' favours less popular candidates and 'established' more popular ones", () => {
  const emerging = scoreScan({ calls: [brands, podcasts], seeds: [SEED], prefer: "emerging" });
  const established = scoreScan({ calls: [brands, podcasts], seeds: [SEED], prefer: "established" });
  const size = (scan, name) => scan.candidates.find((candidate) => candidate.name === name).size;
  assert.equal(size(emerging, "Pod Two"), 1);
  assert.equal(size(emerging, "Brand One"), 0);
  assert.equal(size(established, "Brand One"), 1);
  assert.equal(scoreScan({ calls: [brands], seeds: [SEED] }).candidates[0].size, undefined);
});

test("missing evidence scores zero and is named, never a high score", () => {
  const noPopularity = { category: "podcast", envelope: ok([item("Pod Unknown", 5, "podcast", { popularity: undefined })]) };
  const scan = scoreScan({ calls: [brands, noPopularity], seeds: [SEED], prefer: "emerging" });
  const unknown = scan.candidates.find((candidate) => candidate.name === "Pod Unknown");
  assert.deepEqual(unknown.missing, ["popularity"]);
  assert.equal(unknown.size, undefined);
  // Without a seed category, novelty is unknown rather than assumed.
  const blind = scoreScan({ calls: [podcasts], seeds: [{ ...SEED, category: undefined }] });
  assert.deepEqual(blind.candidates[0].missing, ["seed category"]);
  assert.equal(blind.candidates[0].novelty, undefined);
});

test("seeds and duplicates are removed, malformed items ignored", () => {
  const calls = [
    { category: "brand", envelope: ok([entity("Seed Brand", SEED.id.toLowerCase(), { subtype: "urn:entity:brand" }), item("Brand One", 1, "brand"), null, { name: "No ID" }]) },
    { category: "brand", envelope: ok([item("Brand One", 1, "brand")]) },
  ];
  const scan = scoreScan({ calls, seeds: [SEED] });
  assert.deepEqual(scan.candidates.map((candidate) => candidate.name), ["Brand One"]);
});

test("failed and empty categories are reported, not dropped silently", () => {
  const scan = scoreScan({
    calls: [brands, { category: "videogame", envelope: { status: "error", error: { code: "QLOO_RATE_LIMIT" } } }, { category: "book", envelope: ok([]) }],
    seeds: [SEED],
  });
  assert.deepEqual(scan.categories.slice(1), [
    { category: "videogame", status: "error", count: 0, error: "QLOO_RATE_LIMIT" },
    { category: "book", status: "ok", count: 0, error: undefined },
  ]);
});

test("the same evidence and preference always give the same ranking", () => {
  const first = scoreScan({ calls: [brands, podcasts], seeds: [SEED], prefer: "emerging" });
  const second = scoreScan({ calls: [podcasts, brands], seeds: [SEED], prefer: "emerging" });
  assert.deepEqual(
    first.candidates.map((candidate) => [candidate.name, candidate.score]),
    second.candidates.map((candidate) => [candidate.name, candidate.score]),
  );
  assert.equal(first.version, "1");
  assert.deepEqual(first.weights, { fit: 0.6, size: 0.2, novelty: 0.2 });
});

test("one unusually unpopular candidate does not squash everyone else's size", () => {
  const calls = [
    {
      category: "place",
      envelope: ok([0.99, 0.98, 0.97, 0.23].map((popularity, n) => item(`Place ${n}`, 10 + n, "place", { popularity }))),
    },
  ];
  const scan = scoreScan({ calls, seeds: [SEED], prefer: "emerging" });
  const size = Object.fromEntries(scan.candidates.map((candidate) => [candidate.name, candidate.size]));
  assert.deepEqual(size, { "Place 0": 0, "Place 1": 0.33, "Place 2": 0.67, "Place 3": 1 });
});

test("re-ranking stored candidates under another preference matches scoring from scratch", () => {
  const either = scoreScan({ calls: [brands, podcasts], seeds: [SEED] });
  const emerging = scoreScan({ calls: [brands, podcasts], seeds: [SEED], prefer: "emerging" });
  const reranked = rankCandidates(either.candidates, either.seeds, "emerging");
  assert.deepEqual(reranked.candidates, emerging.candidates);
  assert.deepEqual(reranked.weights, emerging.weights);
});
