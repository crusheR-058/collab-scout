import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/db.mjs";

const fresh = () => {
  const db = openDatabase(":memory:");
  db.touchOwner("alice");
  db.touchOwner("bob");
  db.createResearch({ id: "r1", ownerId: "alice", briefText: "A brief", model: "m" });
  return db;
};

test("research is visible only to its owner", () => {
  const db = fresh();
  assert.equal(db.getResearch("alice", "r1").brief_text, "A brief");
  assert.equal(db.getResearch("bob", "r1"), undefined);
  assert.deepEqual(db.listResearch("bob"), []);
  assert.deepEqual(db.listEvents("bob", "r1"), []);
  assert.equal(db.deleteResearch("bob", "r1"), false);
  assert.ok(db.getResearch("alice", "r1"));
});

test("versions are numbered in order and never overwritten", () => {
  const db = fresh();
  assert.equal(db.addVersion("r1", "brief", { brand: "B", partners: [{ name: "P1" }] }), 1);
  assert.equal(db.addVersion("r1", "plan", { partner: "P1" }), 2);
  assert.equal(db.addVersion("r1", "brief", { brand: "B", partners: [{ name: "P2" }], opportunities: { version: "1" } }), 3);
  assert.deepEqual(
    db.listVersions("alice", "r1").map(({ version, kind, scoring_version }) => [version, kind, scoring_version]),
    [[1, "brief", null], [2, "plan", null], [3, "brief", "1"]],
  );
  assert.equal(db.getVersion("alice", "r1", 1).payload.partners[0].name, "P1");
  assert.equal(db.getVersion("bob", "r1", 1), undefined);
  // The list titles a scout from its latest brief.
  assert.equal(db.listResearch("alice")[0].title, "B × P2");
});

test("the schema refuses bad states and orphans", () => {
  const db = fresh();
  assert.throws(() => db.setStatus("r1", "done"), /CHECK/);
  assert.throws(() => db.createResearch({ id: "r2", ownerId: "nobody", briefText: "x", model: "m" }), /FOREIGN KEY/);
  assert.throws(() => db.createResearch({ id: "r3", ownerId: "alice", briefText: "", model: "m" }), /CHECK/);
});

test("forgetting an owner deletes their research, versions and events", () => {
  const db = fresh();
  db.addVersion("r1", "brief", { brand: "B", partners: [] });
  db.addEvent("r1", "tool_call", { name: "qloo_describe" });
  assert.equal(db.deleteOwner("alice"), true);
  assert.equal(db.getResearch("alice", "r1"), undefined);
  assert.deepEqual(db.listEvents("alice", "r1"), []);
});

test("data survives reopening, and open scouts are marked interrupted", () => {
  const folder = mkdtempSync(join(tmpdir(), "collab-scout-db-"));
  const path = join(folder, "nested", "test.db");
  try {
    const first = openDatabase(path);
    first.touchOwner("alice");
    first.createResearch({ id: "open", ownerId: "alice", briefText: "x", model: "m" });
    first.createResearch({ id: "done", ownerId: "alice", briefText: "y", model: "m" });
    first.setStatus("done", "delivered");
    first.addEvent("open", "text", { text: "hello" });
    first.close();

    const second = openDatabase(path);
    assert.equal(second.interruptOpen(), 1);
    assert.equal(second.getResearch("alice", "open").status, "interrupted");
    assert.equal(second.getResearch("alice", "done").status, "delivered");
    assert.deepEqual(second.listEvents("alice", "open").map((event) => event.payload), [{ text: "hello" }]);
    second.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("expiry applies only to a scout still waiting for an answer", () => {
  const db = fresh();
  db.setStatus("r1", "delivered");
  db.expire("r1");
  assert.equal(db.getResearch("alice", "r1").status, "delivered");
  db.setStatus("r1", "needs_input");
  db.expire("r1");
  assert.equal(db.getResearch("alice", "r1").status, "expired");
});

test("metrics are counted from stored data", () => {
  const db = fresh();
  db.setStatus("r1", "delivered");
  db.setUsage("r1", { inputTokens: 100, outputTokens: 5, qlooCalls: 3 });
  db.addEvent("r1", "tool_result", { status: "ok" });
  db.addEvent("r1", "tool_result", { status: "error", error: "QLOO_RATE_LIMIT", retries: 2 });
  const metrics = db.metrics();
  assert.deepEqual(metrics.research_by_status, { delivered: 1 });
  assert.equal(metrics.delivered.qloo_calls, 3);
  assert.deepEqual(
    metrics.qloo_results.map(({ outcome, count, retries }) => [outcome, count, retries]).sort(),
    [["QLOO_RATE_LIMIT", 1, 2], ["ok", 1, 0]],
  );
});

test("a sign-in session finds its owner until it expires or is deleted", () => {
  const db = fresh();
  db.touchOwner("alice", "alice@example.com");
  const later = new Date(Date.now() + 60_000).toISOString();
  db.createSession("live", "alice", later);
  db.createSession("old", "alice", new Date(Date.now() - 1000).toISOString());
  assert.deepEqual({ ...db.getSession("live") }, { owner_id: "alice", email: "alice@example.com" });
  assert.equal(db.getSession("old"), undefined);
  assert.equal(db.purgeSessions(), 1);
  db.deleteSession("live");
  assert.equal(db.getSession("live"), undefined);
});

test("an existing email is kept when an owner is touched without one", () => {
  const db = fresh();
  db.touchOwner("alice", "alice@example.com");
  db.touchOwner("alice");
  db.createSession("s", "alice", new Date(Date.now() + 60_000).toISOString());
  assert.equal(db.getSession("s").email, "alice@example.com");
  // Deleting the owner ends their sessions too.
  db.deleteOwner("alice");
  assert.equal(db.getSession("s"), undefined);
});
