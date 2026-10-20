# Testing

## Offline tests (no credentials, no cost)

```sh
npm test
```

Runs every `test/*.test.mjs` with Node's built-in test runner. Nothing here calls Qloo or Bedrock:

| File | What it covers |
| --- | --- |
| `test/agent.test.mjs` | The agent loop with a scripted model and a fake Qloo: delivery, questions and answers, reused identical calls, the per-turn and per-run Qloo budgets, the step limit, cancellation, model failures, garbled tool names. |
| `test/opportunities.test.mjs` | Opportunity scoring: fit from Qloo's order within a call, novelty, emerging and established preferences, percentile size robust to outliers, missing data, duplicates and seeds removed, failed categories reported, deterministic order. |
| `test/log.test.mjs` | How calls are described in the field log and in partner records, including filters and named entity IDs. |
| `test/brief.test.mjs` | Brief validation and repair; the evidence ledger (observations kept per call, driving seeds, calculated trends, heatmap places); grounding (scores only from Qloo, one shared call for affinity, model fields whitelisted, locations checked). |
| `test/qloo.test.mjs` | The Qloo adapter's server-wide concurrency cap and bounded retries on rate limits, including Stop during a backoff. |
| `test/server.test.mjs` | The real server process without Qloo or Cognito: the app stays closed (sign-in 503, `/scout` redirects, API 401) and the app page is not reachable as a static file; input validation, JSON errors without stack traces, body-size limit, security headers, unknown sessions, and the error a scout ends with when Qloo is missing. |
| `test/db.test.mjs` | The repository: owner scoping in every read and delete, version numbering that never overwrites, schema constraints (status list, foreign keys, brief length), cascading deletes, data surviving a reopen, interrupted and expired states, metrics from stored data. |
| `test/api.test.mjs` | The real server against fake providers: an HTTP/2 server playing Bedrock Converse, a script playing `qloo mcp`, and a token endpoint playing Cognito that checks the PKCE verifier. Sign-in through real redirects and cookies; wrong state, forged audience and missing flow cookie refused; signed out, `/scout` redirects and the API answers 401; another account gets 404 for read, answer, versions and delete; answer, brief and plan stored as numbered versions; saved research readable after a restart while the open session is not; metrics behind a token; `no-store`, request IDs and one error shape; sign-out ends the session and points at Cognito's logout; deleting all scouts ends the session. |
| `test/stream.test.mjs` | The browser's event-stream reader against a misbehaving server: split, garbled and heartbeat frames, and error responses. |

The fakes in `test/api.test.mjs` exercise the real HTTP, SDK and MCP client paths but are not Qloo or Bedrock; they prove the plumbing, not the research.

`test/fixtures.mjs` holds synthetic envelopes in the shape `qloo mcp` returns. Their names and IDs are made up; they are not Qloo data and are never shown as results.

## Offline UI check (needs Microsoft Edge, no credentials)

```sh
node scripts/ui-offline.mjs <folder outside the repo>
```

Starts the server without Qloo, puts a synthetic scout in the page's history (built by the real grounding, scoring, profile and plan code from the made-up fixtures) and opens it. It walks every tab: the brief, Audience DNA, Opportunities (hides a category, re-ranks for established partners, hovers a dot, selects a candidate, moves between tabs with the arrow keys) and Plans (switches between two plans). It prints what it found, saves desktop and phone screenshots of each tab, and reports page errors, stray `false`/`undefined`/`NaN` text, content that runs past the screen edge on a phone, and whether print includes every tab.

## Live checks (need Qloo and Bedrock credentials, spend quota)

Run these only when a change affects the real research flow.

```sh
npm start
node scripts/ui-check.mjs http://localhost:8787 <folder outside the repo>
```

`ui-check.mjs` drives a full scout in Microsoft Edge: guided form, questions, brief, partner records, the Audience DNA and Opportunities tabs, a partnership plan for the top partner, one revision, history, phone width and print. It prints the partner count, how many matched in Qloo, and any page or console errors (including Content-Security-Policy violations). Screenshots contain Qloo results, so keep them out of the repository.

```sh
node --env-file=.env scripts/bakeoff.mjs [runs-per-brief]
```

Runs five fixed briefs (three ordinary, two edge cases) through the agent, or one with `[brief-name]`, and prints one JSON line per run: outcome, partners matched in Qloo, unsupported names and places, the shared-affinity basis, trends, scan and profile, questions asked, tool problems, whether the brief was sent back, model tokens, Qloo requests, seconds, and the first limitation for a human to read.

## Results log

| Date | Check | Result |
| --- | --- | --- |
| 2026-10-15 | `npm test` | 33 passed |
| 2026-10-15 | `ui-check.mjs`, live, coffee roastery brief | Brief delivered; 5 of 5 partners matched in Qloo; revision changed the top match; history reopened; no page errors. Found a garbled pitch that had swallowed the limitations, now rejected by `checkBrief`. |
| 2026-10-15 | `npm test` | 45 passed |
| 2026-10-15 | `ui-check.mjs`, live | 5 of 5 matched; `qloo_rank` and `qloo_trends` failed with `QLOO_RATE_LIMIT`; the brief said so and showed no trends. Led to the adapter's retry and concurrency cap. |
| 2026-10-15 | `ui-check.mjs`, live, after the retry | Both rate-limited calls succeeded on retry. Affinity bars from one `qloo_rank` call covering 5 of 5 partners; 4 trends (all flat); records listed per partner; revision and history worked; no page errors. |
| 2026-10-15 | `ui-check.mjs`, live, with the scan | Scan of artist, brand, place and podcast from Blue Bottle Coffee: 40 candidates, 12 shown. 5 of 5 partners matched; revision and history worked; no page errors. The seed was Blue Bottle's place entity, not the brand; the table now shows seed categories so this is visible. |
| 2026-10-15 | `ui-offline.mjs` | Counts match the fixture (4 matched, 1 not found, 1 trend, 8 rows, 1 unchecked location). Found the phone overflow; after the fix, no page errors. Confirmed the overflow check fails when the fix is removed. |
| 2026-10-15 | `npm test` | 60 passed |
| 2026-10-15 | `npm test` | 71 passed |
| 2026-10-15 | `ui-offline.mjs` | All four tabs; filters, re-ranking, selection, arrow keys, plan switching and print all worked; no page errors, stray text or phone overflow. Earlier runs found `false` printed into the page, dots on the plot border, tabs off a phone screen; all fixed. |
| 2026-10-15 | `ui-check.mjs`, live | Model skipped the scan, so no profile or radar: led to the one-time scan request. Plan for the top partner delivered (10 sections, 3 tests, matched in Qloo). |
| 2026-10-15 | `ui-check.mjs`, live, after the scan request | 4 of 4 partners matched; Audience DNA with 3 tag groups and 8 skews; radar with 49 dots across 5 categories; plan for Khushi (10 sections, 3 tests); revision and history worked; no page errors. Scan had no location, so venues were in San Francisco: led to the location label and `venue_city`. |
| 2026-10-15 | Live probes of `qloo_recommend` for places | `signal_location: India` left venues in San Francisco (18 s); `filter_location: Mumbai` gave Mumbai venues (1 s); `filter_location: India` timed out. |
| 2026-10-15 | `bakeoff.mjs 1`, GLM 5 | All five delivered; scan and profile in every run; 0 unsupported names; affinity from one `qloo_rank` call in every run (3/5 partners for the bakery). Qloo calls 12 to 27; input tokens 46k to 299k; 20 to 74 s. The B2B request returned consumer brands without a warning. |
| 2026-10-15 | `bakeoff.mjs 1 offdomain`, after the coverage rule | First limitation: "Qloo maps consumer taste patterns, not B2B purchasing decisions or referral relationships". |
| 2026-10-15 | `npm test` | 73 passed |
| 2026-10-15 | `ui-offline.mjs` | All tabs; no page errors |
| 2026-10-15 | `npm test` | 89 passed, including the repository and the server with fake providers |
| 2026-10-15 | `ui-offline.mjs`, scout seeded in a scratch database | Opened from server-side history with its replayed field log; all tabs; no page errors |
| 2026-10-15 | `ui-check.mjs`, live, server-side history | 4 of 4 matched; profile, radar and plan; revision; after reload the scout reopened from the server with 46 replayed log rows and could still be revised; no page errors |
| 2026-10-15 | Restart after the live run | The record was still `delivered` with 3 versions (brief, plan, revised brief), 78 events, 31 Qloo calls and 481,768 input tokens recorded |
| 2026-10-15 | `npm test` | 93 passed, including sign-in against a fake Cognito |
| 2026-10-15 | Real Cognito, localhost | Test user signed in through managed login and landed on `/scout`; cookie `HttpOnly; Secure; SameSite=Lax`; landing offered "Open your scouts"; sign-out cleared both sessions; `/scout` then redirected to sign-in; no page errors |
| 2026-10-15 | Landing page in Edge | Desktop and phone, every pinned step and the carousel; no console errors after `/api/me` stopped answering 401; reduced motion lays everything out flat; found and fixed CTA below the fold, step numbers on phones, carousel sizing |
| 2026-10-15 | Production after deploy | Landing loads; `/scout` redirects to sign-in; real Cognito sign-in lands in the app with Qloo connected; sign-out returns home with the session ended; no page errors |
