// The HTTP layer, run as a real process with no Qloo, Bedrock or Cognito: the
// paths that work without them, and proof that the app stays closed without
// sign-in configured. Signed-in behaviour is in api.test.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const PORT = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL("../src/server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), QLOO_COMMAND: "qloo-not-installed-for-tests", DATABASE_PATH: ":memory:" },
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

test("malformed JSON gets a short JSON error, not a stack trace", async () => {
  const response = await post("/api/scout", "{not json");
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "The request body is not valid JSON.", code: "INVALID_JSON" });
  assert.doesNotMatch(text, /at |node_modules/);
});

test("a body over the size limit is refused", async () => {
  const response = await post("/api/scout", JSON.stringify({ brief: "x".repeat(30000) }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "The request is too large.", code: "TOO_LARGE" });
});

test("health reports Qloo as not connected when the harness is missing", async () => {
  const response = await fetch(`${base}/api/health`);
  const body = await response.json();
  assert.equal(body.qloo, false);
  assert.equal(typeof body.model, "string");
});

test("without sign-in configured, the app and its API stay closed", async () => {
  const page = await fetch(`${base}/scout`, { redirect: "manual" });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get("location"), "/signin");
  const signIn = await fetch(`${base}/auth/signin`, { redirect: "manual" });
  assert.equal(signIn.status, 503);
  for (const response of [await fetch(`${base}/api/research`), await post("/api/scout", JSON.stringify({ brief: "x" }))]) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "SIGN_IN_REQUIRED");
  }
});

test("the app page is not served as a static file", async () => {
  for (const path of ["/scout.html", "/pages/scout.html", "/index.html"]) {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    assert.doesNotMatch(await response.text(), /id="brief-form"/, path);
  }
});
