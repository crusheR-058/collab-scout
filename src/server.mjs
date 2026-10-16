// HTTP API. Each scout streams its events to the browser as server-sent events
// and is stored, with everything it delivered, for the browser that owns it.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { MODEL, answer, cancel, newSession, planRequest, run } from "./agent.mjs";
import { openDatabase } from "./db.mjs";
import { counters, log } from "./log.mjs";
import { authConfigured, cognitoOrigin, finishSignIn, signInUrl, signOut, userOf } from "./auth.mjs";
import { qlooReady } from "./qloo.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_PATH = process.env.DATABASE_PATH ?? fileURLToPath(new URL("../data/collab-scout.db", import.meta.url));
const METRICS_TOKEN = process.env.METRICS_TOKEN;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BRIEF_CHARS = 2000;
const SCOUTS_PER_HOUR = Number(process.env.SCOUTS_PER_HOUR ?? 8);
const HOUR_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 10 * 1000;
const MAX_REFINEMENTS = 8;
const MAX_NAME_CHARS = 200;
const MAX_NOTE_CHARS = 500;
// Answers to questions and revisions together, so one scout cannot run forever.
const MAX_ANSWERS = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Stored as the field log; deliveries are stored as versions instead.
const LOGGED = new Set(["tool_call", "tool_result", "text", "question", "error"]);

const PAGES = fileURLToPath(new URL("../pages/", import.meta.url));
// Google appears on the sign-in page once it is set up as a Cognito identity provider.
const GOOGLE = process.env.COGNITO_GOOGLE === "1";

const db = openDatabase(DATABASE_PATH);
const interrupted = db.interruptOpen();
if (interrupted) log("warn", "research_interrupted", { count: interrupted });
// Without Cognito no one can sign in, so every protected page and route refuses.
if (!authConfigured) log("warn", "sign_in_not_configured", {});

// Live scouts the model can still continue. The database is the record; this
// holds only what cannot be stored: the conversation and the abort controller.
const sessions = new Map();
const starts = new Map();

// Each scout spends Qloo quota and model tokens, so cap how many one visitor can start.
const underLimit = (ip) => {
  const recent = (starts.get(ip) ?? []).filter((time) => time > Date.now() - HOUR_MS);
  if (recent.length >= SCOUTS_PER_HOUR) return false;
  starts.set(ip, [...recent, Date.now()]);
  return true;
};

// A database failure is logged and counted, but never ends a scout in progress.
const persist = (action, fields) => {
  try {
    return action();
  } catch (error) {
    log("error", "db_failed", { ...fields, reason: error.message });
    return undefined;
  }
};

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.running || session.touched >= cutoff) continue;
    sessions.delete(id);
    persist(() => db.expire(id), { research: id });
  }
  for (const [ip, times] of starts) {
    if (times.every((time) => time < Date.now() - HOUR_MS)) starts.delete(ip);
  }
  persist(() => db.purgeSessions(), {});
}, 60 * 1000).unref();

const fail = (res, status, code, message) => res.status(status).json({ error: message, code });

const stream = async (res, id, session) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
  });
  const started = Date.now();
  let outcome;
  let failure;
  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (LOGGED.has(event.type)) persist(() => db.addEvent(id, event.type, event), { research: id });
    if (event.type === "question") outcome = "needs_input";
    if (event.type === "error") [outcome, failure] = ["failed", event.message];
    if (event.type === "brief" || event.type === "plan") {
      outcome = "delivered";
      const version = persist(() => db.addVersion(id, event.type, event[event.type]), { research: id });
      if (version) res.write(`data: ${JSON.stringify({ type: "saved", version })}\n\n`);
    }
  };
  send({ type: "session", id });
  // CloudFront drops an origin connection that stays silent, so send a comment
  // line while the model is thinking.
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);

  session.running = true;
  // The visitor pressed Stop or closed the page while the scout was running.
  res.on("close", () => {
    if (session.running) cancel(session);
  });
  try {
    for await (const event of run(session)) send(event);
  } catch (error) {
    log("error", "research_crashed", { research: id, reason: error.message });
    session.done = true;
    send({ type: "error", code: "INTERNAL", message: "The scout hit an unexpected problem on the server." });
  } finally {
    clearInterval(heartbeat);
    session.running = false;
    session.touched = Date.now();
    // A run that ends without a question, delivery or error delivered nothing.
    const status = session.cancelled ? "cancelled" : outcome ?? "failed";
    if (!session.cancelled && !outcome) failure = "The scout finished without a brief.";
    persist(() => {
      db.setStatus(id, status, status === "failed" ? failure : null);
      db.setUsage(id, session.usage);
    }, { research: id });
    log("info", "research_run", { research: id, status, ms: Date.now() - started, ...session.usage });
    if (session.done) sessions.delete(id);
    res.end();
  }
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

// Partner photos come from Qloo's image host over https; everything else is ours.
const CSP = [
  "default-src 'self'",
  "img-src 'self' https: data:",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  // Signing out posts here, then redirects to Cognito's logout.
  `form-action 'self'${cognitoOrigin ? ` ${cognitoOrigin}` : ""}`,
].join("; ");

const app = express();
app.disable("x-powered-by");
// One proxy (CloudFront) sits in front in production.
app.set("trust proxy", 1);
app.use((req, res, next) => {
  req.id = randomUUID();
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Request-Id": req.id,
  });
  // Research is private to its owner, so no cache may keep an API response.
  if (req.path.startsWith("/api/")) {
    res.set("Cache-Control", "no-store");
    const started = Date.now();
    res.on("finish", () =>
      log("info", "request", { request: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }),
    );
  }
  next();
});
app.use(express.json({ limit: "20kb" }));
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
app.use((req, _res, next) => {
  req.user = persist(() => userOf(req, db), { request: req.id });
  next();
});

/* ---------- Pages and sign-in ---------- */

app.get("/signin", (req, res) => (req.user ? res.redirect(303, "/scout") : res.sendFile("signin.html", { root: PAGES })));

// The app itself is for signed-in people only.
app.get(["/scout", "/scout.html"], (req, res) => (req.user ? res.sendFile("scout.html", { root: PAGES }) : res.redirect(303, "/signin")));

app.get(["/auth/signin", "/auth/google"], (req, res) => {
  if (!authConfigured) return res.status(503).type("text").send("Sign-in is not configured on this server.");
  res.redirect(303, signInUrl(res, { google: GOOGLE && req.path === "/auth/google" }));
});

app.get("/auth/callback", async (req, res) => {
  if (!authConfigured) return res.redirect(303, "/signin");
  const result = await finishSignIn(req, res, db).catch((error) => ({ problem: "failed", reason: error.message }));
  if (result.problem) {
    log("warn", "sign_in_failed", { request: req.id, problem: result.problem, status: result.status, reason: result.reason });
    return res.redirect(303, `/signin?problem=${result.problem}`);
  }
  log("info", "signed_in", { request: req.id });
  res.redirect(303, "/scout");
});

app.post("/auth/signout", (req, res) => {
  if (!authConfigured) return res.redirect(303, "/");
  res.redirect(303, signOut(req, res, db));
});

/* ---------- API: signed-in people only ---------- */

app.get("/api/health", async (_req, res) => {
  const qloo = await qlooReady().catch(() => false);
  res.json({ qloo, model: MODEL, google: GOOGLE });
});

app.get("/api/metrics", (req, res, next) => (METRICS_TOKEN ? next() : fail(res, 404, "NOT_FOUND", "Not found.")));

// Who is signed in, if anyone: the landing page asks without needing a session.
app.get("/api/me", (req, res) => res.json({ email: req.user?.email ?? null }));

app.use("/api", (req, res, next) => {
  // Metrics have their own token.
  if (req.user || req.path === "/metrics") return next();
  fail(res, 401, "SIGN_IN_REQUIRED", "Sign in to use Collab Scout.");
});

app.post("/api/scout", async (req, res) => {
  const brief = text(req.body?.brief);
  if (!brief || brief.length > MAX_BRIEF_CHARS) {
    fail(res, 400, "INVALID_BRIEF", `Send a brief of 1 to ${MAX_BRIEF_CHARS} characters.`);
    return;
  }
  if (!underLimit(req.ip)) {
    fail(res, 429, "RATE_LIMITED", `You can start ${SCOUTS_PER_HOUR} scouts an hour. Try again later.`);
    return;
  }
  const { ownerId } = req.user;
  const id = randomUUID();
  try {
    db.touchOwner(ownerId);
    db.createResearch({ id, ownerId, briefText: brief, model: MODEL });
  } catch (error) {
    log("error", "db_failed", { request: req.id, reason: error.message });
    fail(res, 503, "STORAGE_UNAVAILABLE", "The scout could not be saved, so it was not started. Try again shortly.");
    return;
  }
  const session = { ...newSession(brief), ownerId, touched: Date.now() };
  sessions.set(id, session);
  await stream(res, id, session);
});

// A live scout, only for the browser that owns it. Someone else's ID gets the
// same answer as an unknown one, so IDs cannot be probed.
const liveSession = (req) => {
  const session = sessions.get(req.params.id);
  return session && session.ownerId === req.user?.ownerId ? session : undefined;
};

// Continue a paused scout with `reply`, within its limits.
const resume = async (req, res, reply, { needsBrief = false } = {}) => {
  const session = liveSession(req);
  if (!session) {
    fail(res, 404, "NOT_FOUND", "This scout has expired. Start a new one.");
    return;
  }
  if (!session.pending || session.running || !reply) {
    fail(res, 409, "NOT_WAITING", "This scout is not waiting for an answer.");
    return;
  }
  if (needsBrief && !session.pending.afterBrief) {
    fail(res, 409, "NO_BRIEF", "A plan needs a delivered brief first.");
    return;
  }
  session.answers = (session.answers ?? 0) + 1;
  if (session.answers > MAX_ANSWERS) {
    fail(res, 429, "ANSWER_LIMIT", "This scout has reached its limit of answers and revisions. Start a new one.");
    return;
  }
  // A reply to a delivered brief asks for a revision or a plan, which costs a full run.
  if (session.pending.afterBrief) {
    session.refinements = (session.refinements ?? 0) + 1;
    if (session.refinements > MAX_REFINEMENTS) {
      fail(res, 429, "REVISION_LIMIT", `A scout allows ${MAX_REFINEMENTS} revisions and plans. Start a new one.`);
      return;
    }
  }
  answer(session, reply);
  persist(() => db.setStatus(req.params.id, "running"), { research: req.params.id });
  await stream(res, req.params.id, session);
};

app.post("/api/scout/:id/answer", (req, res) => resume(req, res, text(req.body?.answer).slice(0, MAX_BRIEF_CHARS)));

app.post("/api/scout/:id/plan", (req, res) => {
  const partner = text(req.body?.partner);
  const note = text(req.body?.note);
  if (!partner || partner.length > MAX_NAME_CHARS || note.length > MAX_NOTE_CHARS) {
    fail(res, 400, "INVALID_PLAN_REQUEST", `Send a partner name of 1 to ${MAX_NAME_CHARS} characters and a note of at most ${MAX_NOTE_CHARS}.`);
    return;
  }
  return resume(req, res, planRequest(partner, note), { needsBrief: true });
});

/* ---------- Saved research: owner-scoped reads and deletes ---------- */

// Unknown, malformed and someone else's research all answer 404.
const ownedResearch = (req, res) => {
  const { ownerId } = req.user;
  const research = UUID.test(req.params.id) ? db.getResearch(ownerId, req.params.id) : undefined;
  if (!research) fail(res, 404, "NOT_FOUND", "No saved scout with that ID.");
  return research && { ownerId, research };
};

app.get("/api/research", (req, res) => res.json({ research: db.listResearch(req.user.ownerId) }));

app.get("/api/research/:id", (req, res) => {
  const found = ownedResearch(req, res);
  if (!found) return;
  const { ownerId, research } = found;
  const versions = db.listVersions(ownerId, research.id);
  const latest = (kind) => versions.filter((version) => version.kind === kind).at(-1);
  const brief = latest("brief");
  // The newest plan for each partner, newest first.
  const plans = [];
  for (const version of versions.filter((entry) => entry.kind === "plan").reverse()) {
    const { payload } = db.getVersion(ownerId, research.id, version.version);
    if (!plans.some((plan) => plan.partner === payload.partner)) plans.push(payload);
  }
  const session = liveSession(req);
  res.json({
    research,
    versions,
    brief: brief && db.getVersion(ownerId, research.id, brief.version).payload,
    plans,
    events: db.listEvents(ownerId, research.id),
    // Whether this server still holds the scout, so it can be revised.
    live: Boolean(session?.pending?.afterBrief && !session.running),
  });
});

app.get("/api/research/:id/versions/:version", (req, res) => {
  const found = ownedResearch(req, res);
  if (!found) return;
  const number = Number(req.params.version);
  const version = Number.isInteger(number) && number > 0 ? db.getVersion(found.ownerId, found.research.id, number) : undefined;
  if (!version) return fail(res, 404, "NOT_FOUND", "No such version of this scout.");
  res.json({ version });
});

app.delete("/api/research/:id", (req, res) => {
  const found = ownedResearch(req, res);
  if (!found) return;
  const session = sessions.get(found.research.id);
  if (session) cancel(session);
  sessions.delete(found.research.id);
  db.deleteResearch(found.ownerId, found.research.id);
  res.status(204).end();
});

// Delete everything this person has saved. Their sessions go with it, so
// this also signs them out here; the Cognito account itself stays.
app.delete("/api/me", (req, res) => {
  const { ownerId } = req.user;
  for (const [id, session] of sessions) {
    if (session.ownerId !== ownerId) continue;
    cancel(session);
    sessions.delete(id);
  }
  db.deleteOwner(ownerId);
  res.clearCookie("cs_session", { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  res.status(204).end();
});

// Operational counts from stored research and this process, for whoever holds
// METRICS_TOKEN. Without the token configured, the route does not exist.
const sameToken = (given) =>
  timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(METRICS_TOKEN).digest());

app.get("/api/metrics", (req, res) => {
  const given = String(req.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!given || !sameToken(given)) return fail(res, 404, "NOT_FOUND", "Not found.");
  res.json({ ...db.metrics(), process: { since: new Date(Date.now() - process.uptime() * 1000).toISOString(), events: counters } });
});

app.use("/api", (_req, res) => fail(res, 404, "NOT_FOUND", "Not found."));

// Body-parser and other errors: a short JSON message, never a stack trace.
app.use((error, req, res, _next) => {
  const status = error.status ?? error.statusCode ?? 500;
  if (status >= 500) log("error", "request_failed", { request: req.id, reason: error.message });
  if (error.type === "entity.parse.failed") return fail(res, status, "INVALID_JSON", "The request body is not valid JSON.");
  if (status === 413) return fail(res, status, "TOO_LARGE", "The request is too large.");
  fail(res, status, "REQUEST_FAILED", "The request could not be handled.");
});

app.listen(PORT, () => {
  log("info", "listening", { url: `http://localhost:${PORT}`, model: MODEL, database: DATABASE_PATH });
});
