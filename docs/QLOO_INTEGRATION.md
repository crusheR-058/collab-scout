# Qloo integration

How Collab Scout reaches Qloo, and what was confirmed against the live service. Everything below was observed with `@qloo/qloo-harness` 0.1.26 and the hackathon credential on 2026-10-15; anything not listed here has not been checked.

## Connection

The server starts `qloo mcp` (the harness's MCP server) once over stdio and shares that connection ([src/qloo.mjs](../src/qloo.mjs)). The browser never talks to Qloo and never sees the key. `QLOO_API_KEY` reaches the harness through the environment; locally, `qloo setup --qloo` stores it instead.

`qloo_capabilities` is used only as the readiness probe behind `/api/health`; the model is not given it.

## Tools the model can call

The nine harness tools, unchanged: `qloo_describe`, `qloo_find_tags`, `qloo_recommend`, `qloo_rank`, `qloo_compare_audiences`, `qloo_entity_tags`, `qloo_audience_demographics`, `qloo_trends`, `qloo_where_popular`. Their input schemas come from the harness at start-up.

The app adds `scan_opportunities`, which runs `qloo_recommend` once per category plus `qloo_entity_tags` and `qloo_audience_demographics` for the seeds. See [EVIDENCE_AND_SCORING.md](EVIDENCE_AND_SCORING.md).

## What a result looks like

Every tool returns an envelope with `status` (`ok`, `empty`, `needs_input`, `partial`, `degraded`, `error`), `summary`, `results`, `result_count`, and usually `interpretation`, `resolution`, `query_intent`, `execution` and `provenance.requests` (the Qloo API requests made, without the key).

| Tool | Fields the app relies on |
| --- | --- |
| `qloo_describe` | `results[].entity_id`, `name`, `popularity`, `properties.short_description`, `properties.image.url`; the type is only in `interpretation.entity.type` |
| `qloo_recommend`, `qloo_rank` | `results[].entity_id`, `name`, `subtype` (such as `urn:entity:artist`), `popularity`, `affinity`; `qloo_recommend` adds `explainability["signal.interests.entities"]` naming the seed that drove each result |
| `qloo_entity_tags` | `results[].name`, `type` (such as `urn:tag:genre:music`), `affinity` |
| `qloo_audience_demographics` | `results[0].query.age` and `.gender`: skews against Qloo's baseline, roughly -1 to 1 |
| `qloo_trends` | `series[].entity.name` and `series[].points[]` with `date` and `population_rank` (newest first); no `results` |
| `qloo_where_popular` | `results[].location` (latitude, longitude) and `query.affinity`; the app adds `nearest_city` from an offline city list |

Ambiguous inputs come back as `status: needs_input` with candidates in `resolution.issues[].candidates`. "Blue Bottle Coffee" by name, for example, matched several café locations (`urn:entity:place`) as well as the brand, so seeds are resolved to IDs with `qloo_describe` before a scan.

## Behaviour observed

- **Affinity is relative to its query.** The same artist had different affinities in different calls. The app never compares affinities across calls; see the shared-call rule in [EVIDENCE_AND_SCORING.md](EVIDENCE_AND_SCORING.md).
- **Popularity values bunch near 1** (most results between 0.8 and 1.0), so the app ranks popularity among candidates rather than using raw values.
- **Trends were flat** for every entity checked over the six months to October 2026: the same population rank on every point. The brief reports "no movement" rather than a direction.
- **`signal_location` does not restrict results.** With `signal_location: India`, place results were still in San Francisco. It only shifts which audience Qloo weighs.
- **`filter_location` works for a city, not a country.** `filter_location: Mumbai` returned Mumbai venues in about a second; `filter_location: India` timed out. The scan therefore takes a city (`venue_city`) for places.
- **Rate limits.** Parallel calls from one scout hit `QLOO_RATE_LIMIT` (HTTP 429) in live runs. The harness marks it retryable but gives no wait time.

## How the app handles failures

| Situation | Handling |
| --- | --- |
| Rate limit or upstream error | Retried twice, after 1.5 s and 4 s ([src/qloo.mjs](../src/qloo.mjs)); then the error goes to the model and into the brief's limitations |
| Many calls at once | At most 3 Qloo calls in flight across the whole server |
| A call that hangs | The MCP client's 60 s timeout per attempt |
| The visitor presses Stop | In-flight calls and any retry wait are aborted |
| The same call twice in a scout | Answered from the first result, not sent again |
| `qloo` not installed or not configured | The scout ends with "Qloo is not available on this server"; `/api/health` reports it |
| Error envelopes | Passed to the model, which is told to retry only when `error.retryable` is true |

## Budgets per run

8 Qloo calls per model turn, 30 per run (a start, an answer or a revision), 24 model steps, 12 answers and 8 revisions or plans per scout. A scan with six categories uses eight calls.

## Known limits

- A call can take several minutes in the worst case: three attempts, each bounded by the 60 s MCP timeout.
- Qloo results are not cached across scouts; caching would need checking against Qloo's terms.
- Qloo describes audiences in aggregate and holds nothing about availability, fees, contracts or willingness to partner.
