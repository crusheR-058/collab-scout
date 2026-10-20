# Architecture

```
Browser ──POST + server-sent events──▶ Express (src/server.mjs)
                                          │
                                          ├─▶ agent loop (src/agent.mjs) ──▶ Amazon Bedrock Converse
                                          │        │
                                          │        └─▶ Qloo adapter (src/qloo.mjs) ──stdio──▶ qloo mcp ──▶ Qloo API
                                          │
                                          ├─▶ SQLite (src/db.mjs): owners, research, versions, events
                                          │
                                          └─▶ static files (public/)
```

## Modules

| File | Job |
| --- | --- |
| `src/server.mjs` | HTTP API, validation, per-visitor and per-scout limits, security headers, session store, event stream |
| `src/agent.mjs` | The tool-calling loop: budgets, reuse of identical calls, scans, delivery of briefs and plans, cancellation, model errors |
| `src/tools.mjs` | The tools the model sees: Qloo's nine plus `ask_user`, `scan_opportunities`, `deliver_brief`, `deliver_plan` |
| `src/prompt.mjs` | The system prompt |
| `src/qloo.mjs` | One shared `qloo mcp` connection, concurrency cap, retries |
| `src/brief.mjs` | Checking model output, the evidence ledger, grounding briefs and plans, the audience profile |
| `src/places.mjs` | Names heatmap cells from an offline city list |
| `src/db.mjs` | Migrations and every query; research reads and deletes are scoped by owner in the SQL |
| `src/auth.mjs` | Cognito sign-in (authorisation code with PKCE), sessions and sign-out |
| `pages/` | Pages served only through routes: the app (`/scout`, signed in) and the sign-in page |
| `public/index.html`, `landing.css`, `js/landing.js` | The landing page |
| `src/log.mjs` | One JSON line per event, and per-process counts of each event |
| `public/js/opportunities.js` | Deterministic opportunity scoring, used by both server and browser |
| `public/js/main.js` | Page flow: start, stream, questions, brief, plans, history |
| `public/js/brief.js` | The finished scout and its tabs |
| `public/js/radar.js`, `dna.js`, `plans.js`, `evidence.js` | Opportunities, Audience DNA, Plans tabs and shared pieces |
| `public/js/compare.js` | The Compare section: a rescan beside this scout's table |
| `pages/share.html`, `public/js/share.js` | The read-only shared brief, drawn by the same `renderBrief` without the app's actions |

## API

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /api/health` | | `{ qloo, model }` |
| `GET /api/me` | | `{ email }`, or `{ email: null }` when signed out |
| `POST /api/scout` | `{ brief }`, 1 to 2,000 characters | Event stream. Creates the research record for the signed-in account |
| `POST /api/scout/:id/answer` | `{ answer }` | Event stream; answers a question or revises a delivered brief |
| `POST /api/scout/:id/plan` | `{ partner, note? }` | Event stream; needs a delivered brief |
| `GET /api/research` | | `{ research: [...] }`: this browser's scouts, newest first, with status and title |
| `GET /api/research/:id` | | `{ research, versions, brief, plans, events, live }`: the latest brief, the newest plan per partner, the field log, and whether it can still be revised |
| `GET /api/research/:id/versions/:n` | | `{ version }`: one stored brief or plan, as delivered |
| `POST /api/research/:id/share` | | `{ token }`: the scout's read-only link, `/s/<token>`, created once and shown again after |
| `DELETE /api/research/:id/share` | | 204; the link stops working |
| `GET /api/shared/:token` | | `{ brief, plans }`, open without sign-in; not the brief text, field log or account |
| `POST /api/research/:id/check` | | `{ checked, partners }`: each partner's latest Qloo trend beside the brief's. Qloo only, no model |
| `POST /api/research/:id/compare` | `{ market?, add? }` | `{ scan, added? }`: the brief's scan run again for another market and/or with one more name. Qloo only, no model |
| `DELETE /api/research/:id` | | 204; stops it if running |
| `DELETE /api/me` | | 204; deletes everything this account has saved and ends its sessions |
| `GET /api/metrics` | `Authorization: Bearer <METRICS_TOKEN>` | Counts from stored research and this process; 404 without the token |

Stream events: `session`, `text`, `tool_call`, `tool_result` (with `error` code and `retries`), `question`, `brief`, `plan`, `saved` (the stored version number), `error` (with `code` and a plain `message`), `done`.

Every error outside a stream is `{ error, code }` with a 4xx or 5xx status; unknown routes answer 404 the same way. Every API response carries `Cache-Control: no-store` and an `X-Request-Id`.

Evidence, comparison and the audience profile are served inside a version rather than by separate routes: a brief version holds every partner's Qloo records, the scan with its scores and method version, and the profile. Re-ranking for another preference runs in the browser with the same scoring module, so it needs no route.

## Persistence

**Choice: SQLite through Node's built-in `node:sqlite`.** Production is one EC2 instance running one Node process behind CloudFront, without user accounts. SQLite on the instance's disk:

- survives restarts and redeploys (`deploy/redeploy.sh` replaces only `src/`, `public/` and `scripts/`; the database is in `data/`);
- adds no dependency, no network hop, no credentials and no monthly cost;
- gives transactions, foreign keys, CHECK constraints and indexes.

**Hours.** To save cost, EventBridge Scheduler stops the instance at 21:00 IST and starts it at 11:00 IST (schedules `collab-scout-stop-2100-ist` and `collab-scout-start-1100-ist` in `ap-south-1`, role `collab-scout-scheduler`, which may only start and stop this instance). The Elastic IP keeps CloudFront's origin fixed, systemd starts the app on boot, and the database survives because the disk is kept. While the instance is down, CloudFront answers 502 and 504 with a "closed for the night" page (`deploy/closed.html`, served from the private bucket `collab-scout-site-651709558319-aps1` through origin access control, as status 503, cached for 60 s). The app's own 503s are not replaced. The origin is tried twice with a 4 s connection timeout, so the page appears after about 8 s rather than 30 s. A scout still running at 21:00 is cut off. For judging, the stop schedule ends on 29 October and a copy, `collab-scout-stop-2100-ist-after-judging`, starts on 17 November, so the app stays on in between. To change the hours, edit the two schedules and the page; to stop pausing, disable the schedules.

**Backups.** Data Lifecycle Manager policy `policy-0e6c404cbaf0aadb2` snapshots the volume tagged `Project=collab-scout` daily at 21:15 IST, after the stop, so the SQLite file is not mid-write, and keeps the last 7 snapshots. To restore, create a volume from a snapshot and swap it in, or copy `data/collab-scout.db` out of it.

Considered and not chosen now:

| Option | Why not yet |
| --- | --- |
| Amazon RDS for PostgreSQL | About $15 or more a month, a VPC connection and a credential to manage, for one process with modest writes. Worth it with several app instances. |
| Supabase (Postgres plus Auth) | Its value here is managed accounts. Choosing accounts is a product decision, and no Supabase project or credentials exist for this app. |

The trade-off: the data lives on one instance's disk, backed up by nightly snapshots (see Backups), and running two app instances would need Postgres. All SQL is in `src/db.mjs`, so a move to Postgres changes one module and its migrations.

Schema (migrations 1 to 3): `owners` (one per Cognito account, with its email);  `auth_sessions` (hashed session tokens with expiry); `shares` (at most one read-only link per research, a random 192-bit token kept as is so the owner can see the link again); `research` (one row per scout, status from a fixed list, token and Qloo call totals); `versions` (each delivered brief or plan, numbered, never rewritten, with the scoring method version); `events` (the field log: every tool call and result, note, question and error, which is also the audit trail). Foreign keys cascade from owner to research to versions and events. Migrations are append-only and tracked in `PRAGMA user_version`.

Research states: `running`, `needs_input`, `delivered`, `failed`, `cancelled`, `expired` (waited too long for an answer) and `interrupted` (open when the server restarted). On start, the server marks every `running` and `needs_input` row interrupted, so nothing stays active forever.

## Accounts and authorisation

Everyone signs in; there is no guest access. Sign-in is **Amazon Cognito** managed login (user pool `ap-south-1_FQQMfc2Yh`, Essentials tier, free up to 10,000 monthly active users), which handles sign-up, email verification, password reset and "Continue with Google" (Google is a Cognito identity provider; `COGNITO_GOOGLE=1` shows the button).

The flow ([src/auth.mjs](../src/auth.mjs)) is the OAuth 2 authorisation code flow with PKCE and a **public client with no secret**: `/auth/signin` sets a ten-minute `cs_signin` cookie holding the state and PKCE verifier and redirects to Cognito; `/auth/callback` checks the state, exchanges the code with the verifier at Cognito's token endpoint, and checks the ID token's issuer, audience, `token_use` and expiry. The token comes straight from Cognito over TLS in exchange for a code bound to the verifier, so its signature is not re-checked (OpenID Connect Core 3.1.3.7).

A sign-in becomes a server-side session: a random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` `cs_session` cookie for 30 days, stored only as a SHA-256 hash in `auth_sessions`. The owner of research is the account: its ID is a hash of the Cognito `sub`, so the same person reaches the same scouts on any device. Every research query includes the owner, and another account's ID answers 404 like an unknown one. Live sessions check the owner before an answer or plan is accepted.

| Route | Signed out |
| --- | --- |
| `/`, `/signin`, `/api/health`, `GET /api/me` (answers `{ email: null }`) | Open |
| `/s/:token`, `GET /api/shared/:token` | Open to anyone with the link, until the owner turns it off; an unknown or revoked token answers 404 |
| `/scout` | Redirects to `/signin` |
| Every other `/api/` route | 401 `SIGN_IN_REQUIRED` |
| `POST /auth/signout` | Deletes the session, clears the cookie and redirects to Cognito's logout, which returns to `/` |

Without `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID` and `COGNITO_USER_POOL_ID` the server logs `sign_in_not_configured` and stays closed: `/auth/signin` answers 503 and nothing behind sign-in opens.

"Delete all my scouts" (`DELETE /api/me`) deletes the owner, its research and its sessions; the Cognito account stays, and signing in again starts empty.

Cross-site requests: the session cookie is not sent on cross-site POSTs (`SameSite=Lax`), JSON bodies need a CORS preflight that the server never approves, the CSP's `form-action` allows only the site and Cognito's domain, and CloudFront's caching is disabled for the site (checked 2026-10-15) with `no-store` on every API response.

## Research execution

Server-sent events over the request that started the work remain the model: a run takes 20 to 75 seconds in the bake-off, there is one server process, and every run is bounded (steps, calls, a 120 s model timeout and an 8-minute run limit). A dropped connection cancels the run and its record says so. A job queue would only be needed for runs that outlive a connection or for several workers, so none was added.

Each run's outcome is written when it ends: a question leaves it `needs_input`, a brief or plan `delivered` (with a new version), an error `failed` with its plain message, a disconnect or Stop `cancelled`, and a run that delivered nothing `failed`. A database failure during a run is logged and counted but does not stop the scout; a failure to create the record refuses to start it (503).

## Observability

Logs are JSON lines: `request` (method, path, status, ms, request ID), `research_run` (research ID, status, ms, tokens, Qloo calls), `qloo_retry`, `model_failed` (code and provider error), `qloo_unavailable`, `db_failed`, `research_interrupted`, `request_failed`. Brief text, cookies, keys and Qloo payloads are not logged.

`GET /api/metrics` reports, from stored data: research by status; for delivered research, totals of Qloo calls and tokens and the mean duration; and Qloo results by status or error code with their retries. From the process: counts of each log event since it started, which include rate-limit retries, model failures and database failures.

## Research lifecycle

1. A brief creates a research record (random ID, owned by this browser) and starts a run. The model resolves names, asks when a match is ambiguous, scans categories, ranks a shortlist, checks trends and places, and delivers a brief. Before the first scan the app asks the user to confirm the seeds it will read the audience through (for example "Blue Bottle Coffee (brand)"); the answer goes back to the model as the held scan's result, and the model calls the scan again or resolves someone else.
2. Every Qloo result is recorded in the session's evidence ledger as it arrives, and every progress event is stored as it is sent. The delivered brief is grounded against the ledger, then stored as a version.
3. After a brief, the live session stays in memory for revisions and plans until it has been idle for 30 minutes or reaches its limits. Each revision or plan is a new version; earlier ones are kept.
4. Once the live session is gone, the stored record, its versions and its field log remain readable by the owner until deleted. A stored brief can still be shared, checked for trend changes and compared with another market or audience, because those use Qloo and the stored scan, not the model.

## Limits per scout

| Limit | Value |
| --- | --- |
| Scouts started per visitor per hour | 8 (`SCOUTS_PER_HOUR`) |
| Model steps per run | 24, with a wrap-up prompt at 20 |
| Qloo calls per model turn / per run | 8 / 30 |
| Qloo calls in flight across the server | 3 |
| Answers, and revisions or plans, per scout | 12, and 8 |
| Model request timeout | 120 s |
| Request body | 20 KB |

## Security

- Accounts and authorisation: see above.

- Qloo and AWS credentials stay on the server. Bedrock and server errors reach the browser as short messages without provider text; malformed JSON gets a JSON error, never a stack trace.
- Content-Security-Policy allows scripts and connections to the site itself only; every model and Qloo string is put into the page as text, never HTML. Partner images must be `https://`.
- A session ID is the only key to a scout. It is random and sent only to the browser that started it.
- Text inside Qloo results is treated as data in the system prompt, and the model's tools only read from Qloo, so retrieved text cannot cause side effects.
- In production the instance accepts port 8787 only from CloudFront's origin-facing prefix list (checked 2026-10-15). CloudFront appends the viewer's address to `X-Forwarded-For`, which `trust proxy 1` reads, so the per-visitor limit uses the real address. Run locally without a proxy, that header could be spoofed.
- `npm audit --omit=dev` reported no vulnerabilities on 2026-10-15.
- Provider error text stays in server logs; the browser gets a code and a plain message. Qloo failures are classified as rate limit, timeout, upstream, auth, invalid input, invalid response, transport or cancelled, and an empty result is a valid `empty` status, not an error.
