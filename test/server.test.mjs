// The HTTP layer, run as a real process. Only paths that need neither Qloo nor
// Bedrock are exercised here.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const PORT = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL("../src/server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), QLOO_COMMAND: "qloo-not-installed-for-tests" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve());
    server.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => server.kill());

const post = (path, body, headers = { "Content-Type": "application/json" }) =>
  fetch(`${base}${path}`, { method: "POST", headers, body });

test("the page is served with security headers and no framework banner", async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.match(await response.text(), /Collab Scout/);
});

test("an empty or oversized brief is rejected", async () => {
  for (const brief of ["", "   ", "x".repeat(2001), 42]) {
    const response = await post("/api/scout", JSON.stringify({ brief }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /1 to 2000 characters/);
  }
});

test("malformed JSON gets a short JSON error, not a stack trace", async () => {
  const response = await post("/api/scout", "{not json");
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "The request body is not valid JSON." });
  assert.doesNotMatch(text, /at |node_modules/);
});

test("a body over the size limit is refused", async () => {
  const response = await post("/api/scout", JSON.stringify({ brief: "x".repeat(30000) }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "The request is too large." });
});

test("answering an unknown scout is a 404", async () => {
  const response = await post("/api/scout/not-a-session/answer", JSON.stringify({ answer: "yes" }));
  assert.equal(response.status, 404);
});

test("health reports Qloo as not connected when the harness is missing", async () => {
  const response = await fetch(`${base}/api/health`);
  const body = await response.json();
  assert.equal(body.qloo, false);
  assert.equal(typeof body.model, "string");
});

test("a scout without Qloo ends with a plain error event", async () => {
  const response = await post("/api/scout", JSON.stringify({ brief: "I am a test brief." }));
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const events = (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)));
  assert.equal(events[0].type, "session");
  assert.deepEqual(events.at(-1), { type: "error", message: "Qloo is not available on this server." });
});
