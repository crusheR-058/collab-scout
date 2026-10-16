# Collab Scout

Collab Scout is an agent that helps small brands, creators, venues and event organisers find the right partner: a collaborator, a sponsor, a support act, or a city for a pop-up. You describe who you are and what you want, and it returns a ranked shortlist with the Qloo taste data behind each pick.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Live demo: https://d3269rncf4uvz.cloudfront.net

## The problem

Big brands pay agencies for audience-overlap research before they sign a partnership. A café, an indie musician or a small clothing label picks partners by gut feel or follower counts. A general-purpose chatbot can suggest names, but it is guessing: it has no data on whose audiences actually overlap.

## How it uses Qloo

The agent has no opinions of its own about who fits. Every recommendation has to come from a Qloo result in the same run. A typical scout goes through these steps:

| Step | What happens | Qloo tools |
| --- | --- | --- |
| 1. Pin down who you mean | Resolves your brand, or the well-known names it resembles, to Qloo entities and tags. If a match is ambiguous it stops and asks you. | `qloo_describe`, `qloo_find_tags` |
| 2. Map the audience's taste | Scans several categories at once from your resolved names (`scan_opportunities`), scores every candidate with a fixed, documented method, and reads the audience's Qloo tags and age and gender skew. | `qloo_recommend`, `qloo_entity_tags`, `qloo_audience_demographics` |
| 3. Rank a shortlist | Scores every candidate in one call, because scores from separate calls are not comparable. | `qloo_rank`, `qloo_compare_audiences` |
| 4. Check momentum and place | Looks at who is rising and where the overlap is strongest. | `qloo_trends`, `qloo_where_popular` |
| 5. Write the brief | Ranked partners, the findings behind each, a pitch, and what the data does not show. | |

The field log in the UI lists every Qloo call as it happens. Opening a row shows the input that was sent and the Qloo API requests behind the result.

Every number the brief shows comes from Qloo or from a documented calculation on Qloo data; the model's own numbers are discarded. Affinity is only compared within the Qloo call that produced it. Each partner carries its Qloo records: every call that returned it, its place in that result, and when. The method is in [docs/EVIDENCE_AND_SCORING.md](docs/EVIDENCE_AND_SCORING.md); what was confirmed about Qloo itself is in [docs/QLOO_INTEGRATION.md](docs/QLOO_INTEGRATION.md).

## How it is built

```
Browser ──HTTP + server-sent events──▶ Node server ──▶ Amazon Bedrock (model, tool calling)
                                            │
                                            └─stdio─▶ qloo mcp ──▶ Qloo API
```

- **Qloo access** goes through the local `qloo mcp` server from `@qloo/qloo-harness`. The browser never talks to Qloo and never sees the key.
- **The model** runs on Amazon Bedrock through the Converse API. The default is GLM 5; any Bedrock model with tool support works by changing `BEDROCK_MODEL_ID`.
- **The agent loop** is in [src/agent.mjs](src/agent.mjs). It gives the model Qloo's nine tools plus four of its own: `ask_user` pauses for your answer, `scan_opportunities` runs a bounded cross-category scan, and `deliver_brief` and `deliver_plan` return results as structured data. Budgets cap Qloo calls per turn and per run, model steps, answers and revisions; identical calls are reused; Stop aborts work in flight.
- **The brief is checked against Qloo's own results.** [src/brief.mjs](src/brief.mjs) keeps every Qloo observation of every entity in the scout. Partners, plans and locations are grounded against it, and anything Qloo never returned is flagged.
- **Scoring is deterministic** ([public/js/opportunities.js](public/js/opportunities.js)), shared by server and browser so the page can re-rank the same evidence for another preference.
- **The UI** is plain HTML, CSS and JavaScript modules in [public/](public/), with no build step.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What you can do in the UI

- **Fill in a guided brief** (who you are, the kind of partner you want, names your audience loves, market), or write it freely.
- **Watch the scout work.** A stepper shows which of the five stages it has reached, with elapsed time and the number of Qloo calls. You can stop it at any point, which also stops the Qloo calls.
- **Read the brief**: ranked partners with photo, affinity and popularity bars from one shared Qloo call, trends calculated from Qloo's data, each partner's Qloo records, the strongest locations (checked against Qloo's heatmap), a pitch, and what the data does not show. A key says which parts are Qloo data, which are calculated, and which are the scout's reading.
- **Audience DNA**: the tags Qloo associates with your audience, its age and gender skew against Qloo's baseline, what it likes first in each category, and the gaps.
- **Opportunities**: every candidate from the scan on a chart of fit against popularity, with category filters, a breakdown of why each one ranks where it does, and a switch to re-rank for emerging or established partners.
- **Plans**: a partnership plan for a chosen partner (concept, fit, audience hypothesis, value for each side, formats, risks, questions before outreach, a validation plan), beside that partner's Qloo records. Compare plans side by side and revise them.
- **Ask for a change** ("only lesser-known partners", "try brands instead"); revisions and plans together are capped at eight per scout.
- **Copy, print or save the scout as a PDF**, and reopen past scouts with their field log and every version, saved on the server for your browser only.

## Run it

You need Node.js 22.19 or newer, a Qloo hackathon credential, and an AWS account with Bedrock access.

```sh
# 1. Qloo
npm install --global @qloo/qloo-harness
qloo setup --qloo          # enter your event credential when prompted
qloo setup --status

# 2. AWS: sign in so the SDK can find credentials
aws configure

# 3. The app
npm install
npm start
```

Open http://localhost:8787.

To run a scout in the terminal instead:

```sh
npm run scout -- "I run a specialty coffee roastery like Blue Bottle Coffee and want a rising musician to collaborate with in India"
```

### Settings

Copy `.env.example` to `.env` to change any of these.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QLOO_API_KEY` | unset | Qloo credential. Leave unset locally if you ran `qloo setup --qloo`; set it as a secret on a server. |
| `AWS_REGION` | `ap-south-1` | Bedrock region. |
| `BEDROCK_MODEL_ID` | `zai.glm-5` | Model that drives the agent. |
| `PORT` | `8787` | HTTP port. |
| `SCOUTS_PER_HOUR` | `8` | How many scouts one visitor can start per hour. |
| `DATABASE_PATH` | `data/collab-scout.db` | SQLite file for saved scouts. Back it up; it holds every saved scout. |
| `METRICS_TOKEN` | unset | Enables `GET /api/metrics` for requests that send it as a bearer token. |
| `APP_URL` | `http://localhost:8787` | The site's own address, for Cognito's redirects. |
| `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID` | unset | Cognito sign-in. Without them nobody can sign in and the app stays closed. Localhost on port 8787 is already allowed as a callback. |
| `COGNITO_GOOGLE` | unset | Set to `1` once Google is added to the user pool, to show "Continue with Google". |

## Tests

```sh
npm test                                        # offline: no credentials, no cost
node scripts/ui-offline.mjs <folder>            # offline UI check in Microsoft Edge
node scripts/ui-check.mjs http://localhost:8787 <folder>   # live scout in Edge
node --env-file=.env scripts/bakeoff.mjs [runs] # live measurements per brief
```

See [docs/TESTING.md](docs/TESTING.md) for what each covers and the results so far.

## Limits

- **Small and local brands are often not in Qloo.** When your own brand does not resolve, the agent reads its audience through well-known names it resembles, and says so in the brief. The result is then only as good as that comparison.
- **Affinity is aggregate.** An overlap is a pattern across many people. It is not a prediction about any one customer, and it does not show that a partnership will sell.
- **No personal data goes to Qloo.** The agent is instructed not to send names of private individuals, emails or account identifiers, and not to help with decisions about an individual's eligibility for anything.
- **Everyone signs in.** Scouts belong to the Cognito account, on any device. "Delete all my scouts" removes them; the account itself stays.
- **A scout in progress cannot survive a restart.** Saved results do; an open conversation with the model is marked interrupted, and a scout can be revised only while the server holds it (30 idle minutes).
- **Scores are heuristic.** The opportunity score ranks within one scan; it says nothing about availability, cost or sales.
- **Trends are often flat** in the hackathon data, and the brief says so rather than guessing a direction.

## Credits and licence

Place names for Qloo's heatmap cells come from [GeoNames](https://www.geonames.org/) data (CC BY 4.0), through the `all-the-cities` package.

Released under the [MIT licence](LICENSE).
