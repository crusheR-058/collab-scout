// How Qloo calls are described in the field log and in a partner's records.
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCall, named } from "../public/js/log.js";

test("a recommend call names its signals, tag filters and place", () => {
  const input = {
    target_type: "artist",
    signals: ["Blue Bottle Coffee"],
    include_tags: ["urn:tag:genre:music:indian_indie"],
    signal_location: "India",
  };
  assert.equal(
    describeCall("qloo_recommend", input),
    "Find artists this audience likes, from Blue Bottle Coffee, tagged indian indie, audience in India",
  );
});

test("a rank call names the audience it ranked against", () => {
  assert.equal(
    describeCall("qloo_rank", { options: ["a", "b"], signals: ["Seed"] }),
    "Rank 2 candidates against the audience of Seed",
  );
});

test("entity IDs are shown by name where the scout knows them", () => {
  const id = "00000000-0000-4000-8000-0000000000AA";
  assert.deepEqual(named({ signals: [id.toLowerCase(), "Other"] }, { [id]: "Seed Brand" }), { signals: ["Seed Brand", "Other"] });
});
