// HTTP API. Each scout streams its events to the browser as server-sent events.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { MODEL, answer, cancel, newSession, run } from "./agent.mjs";
import { qlooReady } from "./qloo.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BRIEF_CHARS = 2000;
const SCOUTS_PER_HOUR = Number(process.env.SCOUTS_PER_HOUR ?? 8);
const HOUR_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 10 * 1000;
const MAX_REFINEMENTS = 5;
// Answers to questions and revisions together, so one scout cannot run forever.
const MAX_ANSWERS = 12;

const sessions = new Map();
const starts = new Map();

// Each scout spends Qloo quota and model tokens, so cap how many one visitor can start.
const underLimit = (ip) => {
  const recent = (starts.get(ip) ?? []).filter((time) => time > Date.now() - HOUR_MS);
  if (recent.length >= SCOUTS_PER_HOUR) return false;
  starts.set(ip, [...recent, Date.now()]);
  return true;
};

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.touched < cutoff) sessions.delete(id);
  }
  for (const [ip, times] of starts) {
    if (times.every((time) => time < Date.now() - HOUR_MS)) starts.delete(ip);
  }
}, 60 * 1000).unref();

const stream = async (res, id, session) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
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
    console.error("Scout failed:", error);
    session.done = true;
    send({ type: "error", message: "The scout hit an unexpected problem on the server." });
  } finally {
    clearInterval(heartbeat);
    session.running = false;
    session.touched = Date.now();
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
  "form-action 'self'",
].join("; ");

const app = express();
app.disable("x-powered-by");
// One proxy (CloudFront) sits in front in production.
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  next();
});
app.use(express.json({ limit: "20kb" }));
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

app.get("/api/health", async (_req, res) => {
  const qloo = await qlooReady().catch(() => false);
  res.json({ qloo, model: MODEL });
});

app.post("/api/scout", async (req, res) => {
  const brief = text(req.body?.brief);
  if (!brief || brief.length > MAX_BRIEF_CHARS) {
    res.status(400).json({ error: `Send a brief of 1 to ${MAX_BRIEF_CHARS} characters.` });
    return;
  }
  if (!underLimit(req.ip)) {
    res.status(429).json({ error: `You can start ${SCOUTS_PER_HOUR} scouts an hour. Try again later.` });
    return;
  }
  const id = randomUUID();
  const session = { ...newSession(brief), touched: Date.now() };
  sessions.set(id, session);
  await stream(res, id, session);
});

app.post("/api/scout/:id/answer", async (req, res) => {
  const session = sessions.get(req.params.id);
  const reply = text(req.body?.answer);
  if (!session) {
    res.status(404).json({ error: "This scout has expired. Start a new one." });
    return;
  }
  if (!session.pending || session.running || !reply) {
    res.status(409).json({ error: "This scout is not waiting for an answer." });
    return;
  }
  session.answers = (session.answers ?? 0) + 1;
  if (session.answers > MAX_ANSWERS) {
    res.status(429).json({ error: "This scout has reached its limit of answers and revisions. Start a new one." });
    return;
  }
  // A reply to a delivered brief asks for a revised one, which costs a full run.
  if (session.pending.afterBrief) {
    session.refinements = (session.refinements ?? 0) + 1;
    if (session.refinements > MAX_REFINEMENTS) {
      res.status(429).json({ error: `A scout can be revised ${MAX_REFINEMENTS} times. Start a new one.` });
      return;
    }
  }
  answer(session, reply.slice(0, MAX_BRIEF_CHARS));
  await stream(res, req.params.id, session);
});

// Body-parser and other errors: a short JSON message, never a stack trace.
app.use((error, _req, res, _next) => {
  const status = error.status ?? error.statusCode ?? 500;
  if (status >= 500) console.error("Request failed:", error);
  res.status(status).json({
    error: error.type === "entity.parse.failed" ? "The request body is not valid JSON." : status === 413 ? "The request is too large." : "The request could not be handled.",
  });
});

app.listen(PORT, () => {
  console.log(`Collab Scout listening on http://localhost:${PORT} (model ${MODEL})`);
});
