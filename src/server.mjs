// HTTP API. Each scout streams its events to the browser as server-sent events.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { MODEL, answer, newSession, run } from "./agent.mjs";
import { qlooReady } from "./qloo.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BRIEF_CHARS = 2000;
const SCOUTS_PER_HOUR = Number(process.env.SCOUTS_PER_HOUR ?? 8);
const HOUR_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 10 * 1000;

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
  try {
    for await (const event of run(session)) send(event);
  } catch (error) {
    send({ type: "error", message: error.message });
  } finally {
    clearInterval(heartbeat);
    session.running = false;
    session.touched = Date.now();
    if (session.done) sessions.delete(id);
    res.end();
  }
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

const app = express();
// One proxy (CloudFront) sits in front in production.
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(new URL("../public", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

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
  answer(session, reply.slice(0, MAX_BRIEF_CHARS));
  await stream(res, req.params.id, session);
});

app.listen(PORT, () => {
  console.log(`Collab Scout listening on http://localhost:${PORT} (model ${MODEL})`);
});
