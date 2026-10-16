// The real server with fake providers: a local HTTP/2 server (the protocol the
// Bedrock client speaks) stands in for Bedrock Converse, a small script stands
// in for `qloo mcp`, and an HTTP server stands in for Cognito's token endpoint.
// Covers sign-in, ownership, session isolation, persistence across a restart
// and metrics.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:http2";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { brief, plan } from "./fixtures.mjs";

const folder = mkdtempSync(join(tmpdir(), "collab-scout-api-"));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = "test-client";
const ISSUER = "https://issuer.example";

// `node mcp` in the server's working folder runs this: just enough MCP for
// the app to start, list no Qloo tools, and report ready.
writeFileSync(
  join(folder, "mcp"),
  `const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let line;
  while ((line = buffer.indexOf("\\n")) >= 0) {
    const message = JSON.parse(buffer.slice(0, line));
    buffer = buffer.slice(line + 1);
    if (message.id === undefined) continue;
    if (message.method === "initialize") reply(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-qloo", version: "1" } });
    else if (message.method === "tools/list") reply(message.id, { tools: [] });
    else reply(message.id, { content: [], structuredContent: { status: "ok", adapter: { ready: true }, results: [] } });
  }
});`,
);

// The model's replies, in order.
const turns = [];
const toolTurn = (name, input) => ({
  output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: `t${turns.length}${Math.random()}`.replace(".", ""), name, input } }] } },
  stopReason: "tool_use",
  usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
});
const bedrock = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(turns.shift() ?? { output: { message: { role: "assistant", content: [] } }, stopReason: "end_turn" }));
  });
});

// Cognito's token endpoint: a code names the person, and the PKCE verifier
// must match the challenge the server sent when the sign-in started.
const challenges = new Map();
const tokenOverrides = {};
const cognito = createHttpServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const form = new URLSearchParams(body);
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (req.url !== "/oauth2/token" || form.get("client_id") !== CLIENT_ID || challenges.get(form.get("code")) !== challenge) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    const name = form.get("code");
    const claims = {
      sub: `sub-${name}`,
      email: `${name}@example.com`,
      iss: ISSUER,
      aud: CLIENT_ID,
      token_use: "id",
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...tokenOverrides,
    };
    const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id_token: `${part({ alg: "none" })}.${part(claims)}.sig` }));
  });
});

let server;
const start = async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL("../src/server.mjs", import.meta.url))], {
    cwd: folder,
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_URL: base,
      QLOO_COMMAND: process.execPath,
      DATABASE_PATH: join(folder, "data", "test.db"),
      METRICS_TOKEN: "metrics-secret",
      COGNITO_DOMAIN: `http://127.0.0.1:${cognito.address().port}`,
      COGNITO_CLIENT_ID: CLIENT_ID,
      COGNITO_USER_POOL_ID: "ap-south-1_test",
      COGNITO_ISSUER: ISSUER,
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: `http://127.0.0.1:${bedrock.address().port}`,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_REGION: "ap-south-1",
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve());
    server.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
};
const stop = () =>
  new Promise((resolve) => {
    server.once("exit", resolve);
    server.kill();
  });

before(async () => {
  await new Promise((resolve) => bedrock.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => cognito.listen(0, "127.0.0.1", resolve));
  await start();
});
after(async () => {
  await stop();
  bedrock.close();
  cognito.close();
  rmSync(folder, { recursive: true, force: true });
});

const call = (path, { method = "GET", body, cookie } = {}) =>
  fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    body: body && JSON.stringify(body),
  });
const events = async (response) =>
  (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)));
const cookieOf = (response, name) =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .find((pair) => pair.startsWith(`${name}=`));

// Sign in as `name` the way a browser would; returns the session cookie.
const signIn = async (name, { state } = {}) => {
  const started = await call("/auth/signin");
  assert.equal(started.status, 303);
  const authorize = new URL(started.headers.get("location"));
  assert.equal(authorize.pathname, "/oauth2/authorize");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  challenges.set(name, authorize.searchParams.get("code_challenge"));
  const callback = await call(`/auth/callback?code=${name}&state=${state ?? authorize.searchParams.get("state")}`, {
    cookie: cookieOf(started, "cs_signin"),
  });
  return { callback, session: cookieOf(callback, "cs_session") };
};

let alice;
let bob;
let researchId;

test("signing in sets a private session cookie and opens the app", async () => {
  const { callback, session } = await signIn("alice");
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), "/scout");
  const setCookie = callback.headers.getSetCookie().find((header) => header.startsWith("cs_session="));
  assert.match(setCookie, /cs_session=[\w-]{43}/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  alice = session;
  assert.deepEqual(await (await call("/api/me", { cookie: alice })).json(), { email: "alice@example.com" });
  const page = await call("/scout", { cookie: alice });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sign out/);
  bob = (await signIn("bob")).session;
});

test("a sign-in with the wrong state, a forged audience or no verifier is refused", async () => {
  const wrongState = await signIn("mallory", { state: "not-the-state" });
  assert.equal(wrongState.callback.headers.get("location"), "/signin?problem=expired");
  assert.equal(wrongState.session, undefined);

  tokenOverrides.aud = "someone-elses-client";
  const forged = await signIn("mallory");
  delete tokenOverrides.aud;
  assert.equal(forged.callback.headers.get("location"), "/signin?problem=invalid");
  assert.equal(forged.session, undefined);

  // A callback without the cookie that started the sign-in.
  const noFlow = await call("/auth/callback?code=mallory&state=x");
  assert.equal(noFlow.headers.get("location"), "/signin?problem=expired");
});

test("signed out, the app and its API are closed", async () => {
  const page = await call("/scout");
  assert.equal(page.status, 303);
  assert.equal(page.headers.get("location"), "/signin");
  const research = await call("/api/research");
  assert.equal(research.status, 401);
  assert.equal((await research.json()).code, "SIGN_IN_REQUIRED");
  // Asking who is signed in is always allowed, and answers nobody.
  assert.deepEqual(await (await call("/api/me")).json(), { email: null });
  const scout = await call("/api/scout", { method: "POST", body: { brief: "x" } });
  assert.equal(scout.status, 401);
  // A made-up session token is no session.
  assert.equal((await call("/api/research", { cookie: `cs_session=${"x".repeat(43)}` })).status, 401);
  // Public: the landing page and health.
  assert.equal((await call("/")).status, 200);
  assert.equal((await call("/api/health")).status, 200);
});

test("requests are validated before any work starts", async () => {
  for (const value of ["", "   ", "x".repeat(2001), 42]) {
    const response = await call("/api/scout", { cookie: alice, method: "POST", body: { brief: value } });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_BRIEF");
  }
  for (const body of [{}, { partner: " " }, { partner: "x".repeat(201) }, { partner: "A", note: "x".repeat(501) }]) {
    const response = await call("/api/scout/not-a-session/plan", { cookie: alice, method: "POST", body });
    assert.equal(response.status, 400);
  }
  assert.equal((await call("/api/scout/not-a-session/answer", { cookie: alice, method: "POST", body: { answer: "yes" } })).status, 404);
});

test("starting a scout saves it to the signed-in account", async () => {
  turns.push(toolTurn("ask_user", { question: "Which audience?" }));
  const response = await call("/api/scout", { cookie: alice, method: "POST", body: { brief: "A test brief" } });
  const stream = await events(response);
  researchId = stream[0].id;
  assert.equal(stream.at(-1).type, "question", JSON.stringify(stream.at(-1)));

  const saved = await (await call(`/api/research/${researchId}`, { cookie: alice })).json();
  assert.equal(saved.research.status, "needs_input");
  assert.equal(saved.research.brief_text, "A test brief");
  assert.equal(saved.research.input_tokens, 10);
  assert.deepEqual(saved.events.map((event) => event.type), ["question"]);
});

test("another account cannot see, answer or delete the research", async () => {
  for (const response of [
    await call(`/api/research/${researchId}`, { cookie: bob }),
    await call(`/api/research/${researchId}/versions/1`, { cookie: bob }),
    await call(`/api/scout/${researchId}/answer`, { cookie: bob, method: "POST", body: { answer: "Hijack" } }),
    await call(`/api/research/${researchId}`, { cookie: bob, method: "DELETE" }),
  ]) {
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "NOT_FOUND");
  }
  assert.deepEqual((await (await call("/api/research", { cookie: bob })).json()).research, []);
});

test("the owner answers, gets a brief and a plan, each saved as a version", async () => {
  const three = brief(["One", "Two", "Three"]);
  // The first brief is sent back once for a scan, then accepted.
  turns.push(toolTurn("deliver_brief", three), toolTurn("deliver_brief", three));
  const answered = await events(await call(`/api/scout/${researchId}/answer`, { cookie: alice, method: "POST", body: { answer: "Young adults" } }));
  assert.deepEqual(
    answered.map((event) => event.type),
    ["session", "brief", "saved", "done"],
  );

  turns.push(toolTurn("deliver_plan", plan("One")));
  const planned = await events(await call(`/api/scout/${researchId}/plan`, { cookie: alice, method: "POST", body: { partner: "One" } }));
  assert.deepEqual(
    planned.filter((event) => event.type === "saved").map((event) => event.version),
    [2],
  );

  const saved = await (await call(`/api/research/${researchId}`, { cookie: alice })).json();
  assert.equal(saved.research.status, "delivered");
  assert.deepEqual(saved.versions.map(({ version, kind }) => [version, kind]), [[1, "brief"], [2, "plan"]]);
  assert.equal(saved.brief.partners.length, 3);
  // Qloo returned none of these names, so none is marked as checked.
  assert.ok(saved.brief.partners.every((partner) => partner.verified === false));
  assert.equal(saved.plans[0].partner, "One");
  assert.equal(saved.live, true);
  const listed = (await (await call("/api/research", { cookie: alice })).json()).research;
  assert.equal(listed[0].title, "Test Roastery × One");
});

test("saved research and sign-ins survive a restart; the open session does not", async () => {
  await stop();
  await start();
  const saved = await (await call(`/api/research/${researchId}`, { cookie: alice })).json();
  assert.equal(saved.research.status, "delivered");
  assert.equal(saved.versions.length, 2);
  assert.equal(saved.live, false);
  const answer = await call(`/api/scout/${researchId}/answer`, { cookie: alice, method: "POST", body: { answer: "More" } });
  assert.equal(answer.status, 404);
});

test("metrics need the token and count what was stored", async () => {
  assert.equal((await call("/api/metrics")).status, 404);
  assert.equal((await call("/api/metrics", { cookie: alice })).status, 404);
  const response = await fetch(`${base}/api/metrics`, { headers: { Authorization: "Bearer metrics-secret" } });
  const metrics = await response.json();
  assert.equal(metrics.research_by_status.delivered, 1);
  // Four model turns at 10 input tokens each.
  assert.equal(metrics.delivered.input_tokens, 40);
});

test("API responses are never cacheable and errors share one shape", async () => {
  const response = await call("/api/nothing-here", { cookie: alice });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  assert.deepEqual(await response.json(), { error: "Not found.", code: "NOT_FOUND" });
});

test("signing out ends the session here and at Cognito", async () => {
  const response = await call("/auth/signout", { cookie: bob, method: "POST" });
  assert.equal(response.status, 303);
  const logout = new URL(response.headers.get("location"));
  assert.equal(logout.pathname, "/logout");
  assert.equal(logout.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(logout.searchParams.get("logout_uri"), `${base}/`);
  assert.deepEqual(await (await call("/api/me", { cookie: bob })).json(), { email: null });
  assert.equal((await call("/api/research", { cookie: bob })).status, 401);
});

test("deleting all my scouts removes them and ends the session", async () => {
  const response = await call("/api/me", { cookie: alice, method: "DELETE" });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie"), /cs_session=;/);
  assert.equal((await call(`/api/research/${researchId}`, { cookie: alice })).status, 401);
  // Signing in again starts an empty account.
  const again = (await signIn("alice")).session;
  assert.deepEqual((await (await call("/api/research", { cookie: again })).json()).research, []);
});
