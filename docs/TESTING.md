# Testing

## Offline tests (no credentials, no cost)

```sh
npm test
```

Runs every `test/*.test.mjs` with Node's built-in test runner. Nothing here calls Qloo or Bedrock:

| File | What it covers |
| --- | --- |
| `test/agent.test.mjs` | The agent loop with a scripted model and a fake Qloo: delivery, questions and answers, reused identical calls, the per-turn and per-run Qloo budgets, the step limit, cancellation, model failures, garbled tool names. |
| `test/brief.test.mjs` | Brief validation and repair; the evidence ledger (observations kept per call, driving seeds, calculated trends, heatmap places); grounding (scores only from Qloo, one shared call for affinity, model fields whitelisted, locations checked). |
| `test/qloo.test.mjs` | The Qloo adapter's server-wide concurrency cap and bounded retries on rate limits, including Stop during a backoff. |
| `test/server.test.mjs` | The real server process without Qloo: input validation, JSON errors without stack traces, body-size limit, security headers, unknown sessions, and the error a scout ends with when Qloo is missing. |
| `test/stream.test.mjs` | The browser's event-stream reader against a misbehaving server: split, garbled and heartbeat frames, and error responses. |

`test/fixtures.mjs` holds synthetic envelopes in the shape `qloo mcp` returns. Their names and IDs are made up; they are not Qloo data and are never shown as results.

## Live checks (need Qloo and Bedrock credentials, spend quota)

Run these only when a change affects the real research flow.

```sh
npm start
node scripts/ui-check.mjs http://localhost:8787 <folder outside the repo>
```

`ui-check.mjs` drives a full scout in Microsoft Edge: guided form, questions, brief, one revision, history, phone width and print. It prints the partner count, how many matched in Qloo, and any page or console errors (including Content-Security-Policy violations). Screenshots contain Qloo results, so keep them out of the repository.

```sh
node --env-file=.env scripts/bakeoff.mjs [runs-per-brief]
```

Runs three fixed briefs through the agent and prints one JSON line of measurements per run, for comparing models.

## Results log

| Date | Check | Result |
| --- | --- | --- |
| 2026-10-15 | `npm test` | 33 passed |
| 2026-10-15 | `ui-check.mjs`, live, coffee roastery brief | Brief delivered; 5 of 5 partners matched in Qloo; revision changed the top match; history reopened; no page errors. Found a garbled pitch that had swallowed the limitations, now rejected by `checkBrief`. |
| 2026-10-15 | `npm test` | 45 passed |
| 2026-10-15 | `ui-check.mjs`, live | 5 of 5 matched; `qloo_rank` and `qloo_trends` failed with `QLOO_RATE_LIMIT`; the brief said so and showed no trends. Led to the adapter's retry and concurrency cap. |
| 2026-10-15 | `ui-check.mjs`, live, after the retry | Both rate-limited calls succeeded on retry. Affinity bars from one `qloo_rank` call covering 5 of 5 partners; 4 trends (all flat); records listed per partner; revision and history worked; no page errors. |
