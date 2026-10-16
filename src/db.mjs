// Persistence: one SQLite file through Node's built-in driver. Every query that
// reads or changes research is scoped by owner, so authorisation lives in the
// SQL, not only in the routes. See docs/ARCHITECTURE.md for why SQLite.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const STATUSES = ["running", "needs_input", "delivered", "failed", "cancelled", "expired", "interrupted"];

// Append only: a migration that has shipped is never edited.
const MIGRATIONS = [
  `CREATE TABLE owners (
     id TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL
   );
   CREATE TABLE research (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
     brief_text TEXT NOT NULL CHECK (length(brief_text) BETWEEN 1 AND 2000),
     model TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN (${STATUSES.map((status) => `'${status}'`).join(", ")})),
     error TEXT,
     input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
     output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
     qloo_calls INTEGER NOT NULL DEFAULT 0 CHECK (qloo_calls >= 0),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX research_by_owner ON research(owner_id, updated_at DESC);
   CREATE INDEX research_by_status ON research(status);
   -- A delivered brief or plan, never rewritten: a revision is a new version.
   CREATE TABLE versions (
     research_id TEXT NOT NULL REFERENCES research(id) ON DELETE CASCADE,
     version INTEGER NOT NULL CHECK (version >= 1),
     kind TEXT NOT NULL CHECK (kind IN ('brief', 'plan')),
     scoring_version TEXT,
     payload TEXT NOT NULL CHECK (json_valid(payload)),
     created_at TEXT NOT NULL,
     PRIMARY KEY (research_id, version)
   );
   -- What the scout did, in order: the field log and the audit trail.
   CREATE TABLE events (
     id INTEGER PRIMARY KEY,
     research_id TEXT NOT NULL REFERENCES research(id) ON DELETE CASCADE,
     type TEXT NOT NULL,
     payload TEXT NOT NULL CHECK (json_valid(payload)),
     at TEXT NOT NULL
   );
   CREATE INDEX events_by_research ON events(research_id, id);`,
  // Accounts through Amazon Cognito: an owner is now a signed-in person, and a
  // sign-in is a server-side session that sign-out deletes.
  `ALTER TABLE owners ADD COLUMN email TEXT;
   CREATE TABLE auth_sessions (
     token_hash TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX auth_sessions_by_owner ON auth_sessions(owner_id);
   CREATE INDEX auth_sessions_by_expiry ON auth_sessions(expires_at);`,
];

const now = () => new Date().toISOString();
const parse = (row) => row && { ...row, payload: JSON.parse(row.payload) };

export const openDatabase = (path) => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { user_version: applied } = db.prepare("PRAGMA user_version").get();
  for (const [index, sql] of MIGRATIONS.entries()) {
    if (index < applied) continue;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${index + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const statement = (sql) => db.prepare(sql);
  const sql = {
    upsertOwner: statement(
      `INSERT INTO owners (id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, email = COALESCE(excluded.email, owners.email)`,
    ),
    createSession: statement("INSERT INTO auth_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    getSession: statement(
      `SELECT s.owner_id, o.email FROM auth_sessions s JOIN owners o ON o.id = s.owner_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
    ),
    deleteSession: statement("DELETE FROM auth_sessions WHERE token_hash = ?"),
    purgeSessions: statement("DELETE FROM auth_sessions WHERE expires_at <= ?"),
    deleteOwner: statement("DELETE FROM owners WHERE id = ?"),
    createResearch: statement(
      "INSERT INTO research (id, owner_id, brief_text, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?)",
    ),
    setStatus: statement("UPDATE research SET status = ?, error = ?, updated_at = ? WHERE id = ?"),
    setUsage: statement("UPDATE research SET input_tokens = ?, output_tokens = ?, qloo_calls = ?, updated_at = ? WHERE id = ?"),
    nextVersion: statement("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM versions WHERE research_id = ?"),
    addVersion: statement("INSERT INTO versions (research_id, version, kind, scoring_version, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    addEvent: statement("INSERT INTO events (research_id, type, payload, at) VALUES (?, ?, ?, ?)"),
    list: statement(
      `SELECT r.id, r.brief_text, r.status, r.qloo_calls, r.created_at, r.updated_at,
              (SELECT json_extract(v.payload, '$.brand') || ' × ' || COALESCE(json_extract(v.payload, '$.partners[0].name'), 'no match')
                 FROM versions v WHERE v.research_id = r.id AND v.kind = 'brief' ORDER BY v.version DESC LIMIT 1) AS title
         FROM research r WHERE r.owner_id = ? ORDER BY r.updated_at DESC LIMIT ?`,
    ),
    get: statement("SELECT * FROM research WHERE id = ? AND owner_id = ?"),
    versions: statement(
      `SELECT v.version, v.kind, v.scoring_version, v.created_at FROM versions v
         JOIN research r ON r.id = v.research_id WHERE v.research_id = ? AND r.owner_id = ? ORDER BY v.version`,
    ),
    version: statement(
      `SELECT v.* FROM versions v JOIN research r ON r.id = v.research_id
         WHERE v.research_id = ? AND r.owner_id = ? AND v.version = ?`,
    ),
    events: statement(
      `SELECT e.type, e.payload, e.at FROM events e JOIN research r ON r.id = e.research_id
         WHERE e.research_id = ? AND r.owner_id = ? ORDER BY e.id`,
    ),
    deleteResearch: statement("DELETE FROM research WHERE id = ? AND owner_id = ?"),
    interrupt: statement(
      "UPDATE research SET status = 'interrupted', error = 'The server restarted while this scout was open.', updated_at = ? WHERE status IN ('running', 'needs_input')",
    ),
    expire: statement("UPDATE research SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'needs_input'"),
    statusCounts: statement("SELECT status, COUNT(*) AS count FROM research GROUP BY status"),
    usageTotals: statement(
      `SELECT COUNT(*) AS research, SUM(qloo_calls) AS qloo_calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              AVG((julianday(updated_at) - julianday(created_at)) * 86400) AS mean_seconds
         FROM research WHERE status = 'delivered'`,
    ),
    qlooResults: statement(
      `SELECT COALESCE(json_extract(payload, '$.error'), json_extract(payload, '$.status')) AS outcome, COUNT(*) AS count,
              SUM(COALESCE(json_extract(payload, '$.retries'), 0)) AS retries
         FROM events WHERE type = 'tool_result' GROUP BY outcome`,
    ),
  };

  return {
    close: () => db.close(),
    touchOwner: (ownerId, email = null) => sql.upsertOwner.run(ownerId, email, now(), now()),
    createSession: (tokenHash, ownerId, expiresAt) => sql.createSession.run(tokenHash, ownerId, now(), expiresAt),
    getSession: (tokenHash) => sql.getSession.get(tokenHash, now()),
    deleteSession: (tokenHash) => sql.deleteSession.run(tokenHash),
    purgeSessions: () => sql.purgeSessions.run(now()).changes,
    deleteOwner: (ownerId) => sql.deleteOwner.run(ownerId).changes > 0,
    createResearch: ({ id, ownerId, briefText, model }) => sql.createResearch.run(id, ownerId, briefText, model, now(), now()),
    setStatus: (id, status, error = null) => sql.setStatus.run(status, error, now(), id),
    setUsage: (id, { inputTokens, outputTokens, qlooCalls }) => sql.setUsage.run(inputTokens, outputTokens, qlooCalls, now(), id),
    // Numbered inside one transaction so two deliveries cannot share a number.
    addVersion: (id, kind, payload) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const { next } = sql.nextVersion.get(id);
        sql.addVersion.run(id, next, kind, payload.opportunities?.version ?? null, JSON.stringify(payload), now());
        db.exec("COMMIT");
        return next;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    addEvent: (id, type, payload) => sql.addEvent.run(id, type, JSON.stringify(payload), now()),
    listResearch: (ownerId, limit = 50) => sql.list.all(ownerId, limit),
    getResearch: (ownerId, id) => sql.get.get(id, ownerId),
    listVersions: (ownerId, id) => sql.versions.all(id, ownerId),
    getVersion: (ownerId, id, version) => parse(sql.version.get(id, ownerId, version)),
    listEvents: (ownerId, id) => sql.events.all(id, ownerId).map(parse),
    deleteResearch: (ownerId, id) => sql.deleteResearch.run(id, ownerId).changes > 0,
    // Nothing survives a restart in memory, so open scouts cannot resume.
    interruptOpen: () => sql.interrupt.run(now()).changes,
    expire: (id) => sql.expire.run(now(), id),
    metrics: () => ({
      research_by_status: Object.fromEntries(sql.statusCounts.all().map(({ status, count }) => [status, count])),
      delivered: sql.usageTotals.get(),
      qloo_results: sql.qlooResults.all(),
    }),
  };
};
