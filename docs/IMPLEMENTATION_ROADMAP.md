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

### 03 Discovery: planned

Cultural Opportunity Engine: a bounded, deterministic cross-category scan from resolved seeds, with documented scoring (within-call percentile, novelty, evidence completeness).

### 04 Action: planned

Cultural DNA profile, Opportunity Radar (fit against reach, real values only) and a Partnership Studio plan for a chosen opportunity, as one workflow.

### 05 Quality: planned

Offline and live test split, bake-off extended with evidence metrics, compact Qloo envelopes to the model (fewer tokens), responsive and keyboard checks, security review, documentation.

## Known limitations

- Sessions live in memory; a restart ends scouts in progress.
- Live Qloo and Bedrock checks need the credentials described in the README; offline tests need neither.
