# Evidence and scoring

What a brief claims, where each claim comes from, and how candidates are scored. The code is in [src/brief.mjs](../src/brief.mjs) (evidence and grounding) and [src/opportunities.mjs](../src/opportunities.mjs) (scoring).

## Where each part of a brief comes from

| Kind | Examples | Source |
| --- | --- | --- |
| Qloo data | Partner name, image, popularity, affinity bars, Qloo's description, position in a result, heatmap city | Returned by a Qloo call in this scout, recorded as it arrived |
| Calculated here | Which call the affinity bars come from, trend direction, whether a location matches a heatmap city, opportunity scores | Deterministic code over Qloo data, documented below |
| The scout's reading | Audience summary, rationales, "the scout's reading" bullets, pitch, limitations | Written by the model; it may misread the data |
| Not known | Availability, fees, contracts, willingness to partner, sales effect | Qloo does not hold it; the brief says so |

The model cannot add numbers to a partner. `groundBrief` keeps only the model's `name`, `type`, `rationale` and `evidence` text for each partner; every other field is set from the evidence ledger. A partner Qloo never returned in the scout is marked "Not found in Qloo's results" and shows no numbers.

## Evidence ledger

Each scout keeps every entity Qloo returned, with one observation per call that returned it. Observations are never merged, because an affinity is relative to the query that produced it.

Entity record:

| Field | Meaning |
| --- | --- |
| `id`, `name` | Qloo's entity ID and name |
| `category` | Qloo's subtype, such as `urn:entity:artist` (from the interpretation for `qloo_describe`) |
| `popularity` | Qloo popularity, 0 to 1 (latest seen) |
| `image` | Qloo image URL, kept only if it is `https://` |
| `description` | Qloo's short description, or its description |
| `trend` | Present only when `qloo_trends` returned a series; see below |
| `observations` | One per call, below |

Observation:

| Field | Meaning |
| --- | --- |
| `call` | The tool call ID (a scan's calls get `<scan id>-<category>`) |
| `tool`, `input`, `labels` | The Qloo tool, its input, and names for the entity IDs in the input |
| `position`, `of` | Place in that call's results, and how many results it had |
| `affinity` | Affinity in that call; only comparable within the same call |
| `drivers` | Seed entities Qloo's explainability block says drove the result |
| `at` | When the result arrived (ISO time) |

A reused identical call (same tool and input in the same scout) is answered from the first result and does not add a second observation.

Heatmap cells from `qloo_where_popular` are kept by nearest city (named offline by [src/places.mjs](../src/places.mjs)), keeping the cell with the highest affinity per city.

## Grounding rules

**Affinity bars.** The bars come from one shared call: the call whose results include the most of the brief's partners, preferring `qloo_rank` on a tie, then the latest. A partner outside that call shows no bar; its own affinities stay in its records, labelled "in this query only". The brief states which call the bars come from and how many partners it covers.

**Trend.** Qloo's trend series gives a population rank per date (a smaller rank is more popular). Direction is calculated from the oldest and newest points: rising if the rank number fell, falling if it rose, flat if equal. Fewer than two points gives no trend. The model's own trend claim is discarded.

**Locations.** A location in the brief counts as checked when its name contains a city name from a heatmap cell in this scout. This is a text match, so "Delhi NCR" matches "Delhi"; a location that does not match is flagged.

## Opportunity scoring (method 1)

`scan_opportunities` runs one `qloo_recommend` per category from resolved seed entities, then scores every candidate with `scoreScan`. Scores rank candidates within one scan only; they are heuristic, not a measure of commercial value.

Candidates: every result with a name and entity ID across the scan's calls, minus the seeds, with duplicates removed (first occurrence kept).

| Component | Calculation | Kind |
| --- | --- | --- |
| Fit | `1 - (position - 1) / of`: the candidate's place in Qloo's order within its own category's call. 1 for first place. | Calculated from Qloo's order |
| Size | Only when the user prefers emerging or established partners. Popularity percentile among this scan's candidates (0 least popular, 1 most, ties share a place); emerging uses `1 - percentile`. | Calculated from Qloo popularity |
| Novelty | 1 if the candidate's category differs from every seed's category, else 0 | Calculated from Qloo categories |

Score: `0.6 × fit + 0.2 × size + 0.2 × novelty`. With no size preference the weights become fit 0.75 and novelty 0.25. Scores and components are rounded to two decimals; ties are broken by fit, then name, so the same evidence and preference always give the same order.

Why these choices:

- **Position, not raw affinity, for fit.** Qloo's affinity is relative to its query, so an artist's affinity and a podcast's affinity from separate calls do not compare. Position within each call does.
- **Percentile, not raw popularity, for size.** Qloo's popularity values bunch near 1, and one unusually unpopular candidate would squash a min-max scale.
- **Missing data scores zero.** A candidate without popularity gets size 0; without a seed category, novelty is unknown and scores 0. The `missing` list names what was absent, and the table shows it.

Known weaknesses:

- Fit gives the first result in a two-result call the same 1 as the first in a twenty-result call.
- Popularity percentiles mix categories; Qloo's popularity may not be on the same footing across types.
- Novelty is binary and only knows Qloo's nine entity types, so a coffee brand and a fashion brand are "the same category".
- Scores say nothing about availability, cost or commercial outcome.

A change to any rule above must bump `SCORING_VERSION`; each scan records its version and weights.
