# Implementation roadmap

Work is held to five checkpoints. A checkpoint is finished only when its tests pass and its behaviour has been checked; the next one does not start before that. Demo preparation is out of scope until the product is declared finished.

Status key: **done** (implemented and verified), **in progress**, **planned**.

## Audit summary (2026-10-15)

What exists: an Express server that streams a Bedrock tool-calling loop over server-sent events. The model calls the nine tools of the local `qloo mcp` server plus `ask_user` and `deliver_brief`. The brief is checked against entities Qloo returned. The UI is plain ES modules with no build step. There were no automated tests.

Confirmed by live calls to `qloo mcp` 0.1.26: results carry `entity_id`, `name`, `subtype` (category), `popularity`, a query-relative `affinity`, `explainability` (which signal drove each result) and `properties` (description, image). Envelopes carry `status`, `error.code/retryable/recovery`, `resolution.issues[].candidates` for ambiguous inputs, and `provenance.requests` (the Qloo API requests made).

Defects found:

| Priority | Defect |
| --- | --- |
| P0 | The UI stays on "Scouting" forever when the stream closes without a final event; a malformed event ends the stream with a crash. |
| P0 | Partners Qloo never returned showed affinity and popularity numbers the model made up. |
| P0 | Bedrock and Express error text, including IAM ARNs and stack traces, reached the browser. |
| P0 | Spend per scout was unbounded: unlimited question turns, unlimited parallel Qloo calls per turn, repeated identical calls, no model timeout, Stop did not abort the model call. |
| P0 | No tests and no way to run the agent loop offline. |
| P1 | Affinities from different Qloo queries were merged into one number per entity, so values shown side by side were not comparable. |
| P1 | No security headers; static path broke on folders with spaces. |
| P1 | Full Qloo envelopes (alternatives, query intent, timings) were replayed to the model every step. |

## Checkpoints

### 01 Foundation: done

Existing workflows keep working; errors, validation, sessions and budgets are robust. Verified by `npm test` and a live `ui-check.mjs` run; see [TESTING.md](TESTING.md).

- The UI ends with a clear message when the stream closes without a final event, and skips garbled events.
- Bedrock errors reach the browser as the error name only; malformed JSON and oversized bodies get short JSON errors.
- Security headers (CSP, nosniff, no-referrer); `x-powered-by` removed; static path works in folders with spaces.
- Budgets: 8 Qloo calls per turn, 30 per run, 12 answers and revisions per scout; identical calls reuse the earlier result; model calls time out after 120 s; Stop aborts the model and Qloo calls in flight.
- Brief checks: scores shown come only from Qloo; limitations are required; a text field that swallowed other fields is sent back to the model.
- 33 offline tests.

### 02 Intelligence: done

Real Qloo data drives every number shown, and the evidence behind a partner can be inspected. Verified offline and in two live runs.

- Evidence ledger in `src/brief.mjs`: one observation per Qloo call that returned an entity (call, tool, input, position, query-relative affinity, driving seed entities from Qloo's explainability, time). Observations are never merged.
- Affinity bars come from one shared call: the call whose results include the most partners, preferring `qloo_rank`. A partner outside it shows no bar; its own affinities stay in its records, labelled "in this query only".
- Trend direction is calculated from Qloo's population-rank series (first and last point); the model's trend claim is dropped.
- Brief locations are checked against heatmap cities; unmatched ones are flagged.
- Partners keep only the model's words (name, type, rationale, evidence); every other field is ours.
- The brief states which parts are Qloo data, which are calculated, and which are the scout's reading.
- The Qloo adapter caps calls in flight at 3 across the server and retries `QLOO_RATE_LIMIT` and `QLOO_UPSTREAM` twice with backoff (found live: rank and trends were being rate-limited).
- The system prompt treats text inside Qloo results as data, not instructions.

### 03 Discovery: done

Cultural Opportunity Engine. Verified offline, in a live run, and with the offline UI check. Method: [EVIDENCE_AND_SCORING.md](EVIDENCE_AND_SCORING.md).

- `scan_opportunities` (app tool): the model passes 1 to 5 seed entity IDs that Qloo already returned in this scout (anything else is refused) and up to 6 categories. The app runs one `qloo_recommend` per category through the same budget, cache, rate limiter, field log and evidence ledger as any other call.
- `public/js/opportunities.js` (shared by server and browser) scores candidates deterministically: fit from Qloo's order within each category, size from popularity percentile by the user's preference, novelty for a category other than the seeds'. Missing data scores zero and is named; the method is versioned.
- The brief shows the scored table with the seeds and their categories, what each category returned or why it failed, which rows are partners, and the method in words.
- Field-log and record descriptions now include tag filters, location and demographic, so a filtered call is not described as an unfiltered one.
- Found and fixed during checks: min-max popularity scaling was squashed by one outlier (now percentile rank); the new table widened the brief on phones (fixed, and `ui-offline.mjs` now fails on content past the screen edge); "Built from the No Qloo calls yet" on reopened scouts.

### 04 Action: done

Audience DNA, the Opportunity Radar and the Partnership Studio as one workflow: a finished scout has Brief, Audience DNA, Opportunities and Plans tabs. Verified offline, with the offline UI check across all tabs, and in a live run that went from brief to profile, radar, plan, revision and history.

- **Audience DNA**: every scan also fetches the seeds' Qloo tags and the first seed's demographics. The tab shows them grouped, in Qloo's order, with age and gender skews against Qloo's baseline, the first result per category, and the gaps. No model text.
- **Opportunity Radar**: fit against popularity rank, one dot per candidate, coloured only for "in your partners" (a validated two-colour pair; category is a filter, not a colour). Category filters, a selected candidate's facts and score breakdown, and the full table as the keyboard route. Re-ranking for another size preference uses the shared scoring module and shows each candidate's movement, stating that only the preference changed.
- **Partnership Studio**: `deliver_plan` and `POST /api/scout/:id/plan`. The server writes the plan request; plans are validated and grounded like briefs. Plans can be compared side by side, revised, copied, printed, and are saved with the scout in history.
- **Scan reliability**: a brief without a scan is sent back once to ask for one (found live: the model sometimes skipped it). The scan states its location; venues are kept in a city with `venue_city`, because a country-wide venue filter timed out and `signal_location` alone left venues in San Francisco.
- **Robustness**: one delivery per model turn (an extra brief or plan call gets an answer, as Bedrock requires); revisions and plans share a cap of 8 per scout.
- Found and fixed during checks: `false` printed by `replaceChildren`; dots drawn on the plot border; radar filters lost on switching tabs; tabs scrolling off a phone screen; table fonts and plan switcher width. The offline check now fails on stray `false`/`undefined`/`NaN` text.

### 05 Quality: done

- **Cost**: the model reads a compact view of each Qloo result (58% smaller on live samples), and each session counts the input and output tokens Bedrock reports and the Qloo requests actually sent.
- **Bake-off** (`scripts/bakeoff.mjs`): five briefs including two edge cases (no well-known names; a business-to-business request Qloo does not cover). Each run reports match rate, unsupported names and places, the shared-affinity basis, trends, scan and profile, tokens, Qloo calls, time and the first limitation. Results are in [TESTING.md](TESTING.md).
- **Off-domain requests**: found in the bake-off that a B2B referral request got consumer brands without a warning; the prompt now requires saying that Qloo does not cover business fit, and the re-run's first limitation does.
- **Security**: `npm audit` clean; no secrets in the repository; production origin reachable only from CloudFront, so the per-visitor limit sees real addresses. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Accessibility and layout**: ARIA tabs with arrow keys, toggle buttons with `aria-pressed`, the chart backed by a table with keyboard selection, every tab checked at phone width.
- **Documentation**: README, [ARCHITECTURE.md](ARCHITECTURE.md), [QLOO_INTEGRATION.md](QLOO_INTEGRATION.md), [EVIDENCE_AND_SCORING.md](EVIDENCE_AND_SCORING.md), [TESTING.md](TESTING.md).

### Backend milestone: done

Persistence, ownership, a stored research lifecycle, a uniform API and observability, on the existing Express and SSE design. Details and the reasoning for each choice are in [ARCHITECTURE.md](ARCHITECTURE.md).

- **SQLite** through `node:sqlite` (no new dependency): owners, research, versions, events; migrations, constraints, indexes; all SQL in `src/db.mjs` and scoped by owner. Postgres on RDS or Supabase was weighed and deferred until there are several app instances or accounts.
- **Anonymous ownership**: an `HttpOnly; Secure; SameSite=Lax` cookie holding a random token, stored only as a hash; other browsers get 404; "forget this browser" deletes everything and invalidates the cookie. Accounts are not built: that needs a provider choice and credentials.
- **Lifecycle**: research states written as each run ends; open work marked interrupted on restart; waiting scouts marked expired; each brief and plan stored as an immutable version; the field log stored as events and replayed on reopen.
- **API**: saved-research list, detail, versions, delete; forget-me; token-guarded metrics; `{ error, code }` everywhere, `no-store`, request IDs.
- **Engine**: an 8-minute run limit on top of the step and call budgets; error events carry codes; Qloo failures classified (timeout, cancelled, invalid response, transport, and the harness's own codes), with retry counts.
- **Observability**: JSON logs with request and research IDs; metrics from stored data and process counters.
- **Verified**: 89 offline tests including a server-plus-fake-providers suite; offline and live browser checks; a restart keeping a live scout's record.

### Landing page and accounts: done

A scroll-driven landing page (3D hero, pinned walkthrough of the four steps, a carousel of the four views) and Amazon Cognito sign-in in front of the app, with no guest access. Verified with 93 offline tests including sign-in against a fake Cognito, real Cognito sign-in and sign-out on localhost and in production, and the landing page on desktop, phone and reduced motion. Details in [ARCHITECTURE.md](ARCHITECTURE.md).

### Sharing and follow-up: done

- **Share link**: a read-only `/s/<token>` page for the latest brief and plans, revocable by the owner; the brief text, field log and account stay private.
- **First message**: each plan can carry a short outreach message to the partner, with a copy button and a reminder that Qloo has no contacts.
- **Check for changes**: each partner's latest Qloo trend (20 weekly points) beside the brief's, on demand. Qloo only. There is no scheduled re-check or email: on its own a weekly job would only help someone who opens the app, and sending email needs an SES sender identity.
- **Confirm the starting names**: before the first scan the user confirms whose audience it reads.
- **Compare**: the brief's scan run again for another market and/or with one more name (an ambiguous name takes Qloo's most popular candidate and says so), side by side with overlaps marked. Qloo only; not saved.
- **Export**: Markdown download beside copy and print to PDF.
- **Verified**: 101 offline tests; the offline UI check covers share, check, compare and the first message; a live run confirmed the seed question, a plan's message, a trends check and a comparison against real Qloo (a 90-day trends range returned no points, so a year is asked for).

## Not done, and why

- **No baseline comparison without Qloo** in the bake-off. A fair measure of a general-knowledge answer needs a human rating rubric; the bake-off measures grounding, not quality.
- **Multi-entity "collision" concepts and broader scenario comparison.** The size-preference re-ranking covers one scenario dimension with the same evidence; other scenarios would need new Qloo runs and a comparison view.
- **Long scouts are still expensive.** Measured on a live coffee scout (2026-10-16, 11 steps, 144,543 input tokens): about 47% is the system prompt and tool definitions (about 6,200 tokens) re-sent on every step, and GLM 5 on Bedrock refuses prompt caching. Older Qloo results are now replayed without resolved alternatives or full trend series, which saves about 6% on that run. Dropping their descriptions as well saved 13% on paper, but in one live run with that the model described six partners again (13 steps, 25 Qloo calls), possibly because of it, so descriptions stay. Fewer steps, or a model with prompt caching, are the larger levers.
- **The model still decides which names to resolve**, so a seed can be a single café rather than the brand. The user now confirms the seeds before the first scan, which catches this; a seed a revision adds later is not asked about again.

## Known limitations

- Sessions live in memory; a restart ends scouts in progress.
- Live Qloo and Bedrock checks need the credentials described in the README; offline tests need neither.
