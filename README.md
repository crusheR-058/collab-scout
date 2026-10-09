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
| 2. Map the audience's taste | Finds what the same audience likes in other domains. | `qloo_recommend`, `qloo_entity_tags`, `qloo_audience_demographics` |
| 3. Rank a shortlist | Scores every candidate in one call, because scores from separate calls are not comparable. | `qloo_rank`, `qloo_compare_audiences` |
| 4. Check momentum and place | Looks at who is rising and where the overlap is strongest. | `qloo_trends`, `qloo_where_popular` |
| 5. Write the brief | Ranked partners, the findings behind each, a pitch, and what the data does not show. | |

The field log in the UI lists every Qloo call as it happens. Opening a row shows the input that was sent and the Qloo API requests behind the result.

## How it is built

```
Browser ──HTTP + server-sent events──▶ Node server ──▶ Amazon Bedrock (model, tool calling)
                                            │
                                            └─stdio─▶ qloo mcp ──▶ Qloo API
```

- **Qloo access** goes through the local `qloo mcp` server from `@qloo/qloo-harness`. The browser never talks to Qloo and never sees the key.
- **The model** runs on Amazon Bedrock through the Converse API. The default is GLM 4.7; any Bedrock model with tool support works by changing `BEDROCK_MODEL_ID`.
- **The agent loop** is in [src/agent.mjs](src/agent.mjs). It gives the model Qloo's nine tools plus two of its own: `ask_user`, which pauses the run for your answer, and `deliver_brief`, which returns the brief as structured data.
- **The UI** is plain HTML, CSS and JavaScript in [public/](public/), with no build step.

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
| `BEDROCK_MODEL_ID` | `zai.glm-4.7` | Model that drives the agent. |
| `PORT` | `8787` | HTTP port. |
| `SCOUTS_PER_HOUR` | `8` | How many scouts one visitor can start per hour. |

## Limits

- **Small and local brands are often not in Qloo.** When your own brand does not resolve, the agent reads its audience through well-known names it resembles, and says so in the brief. The result is then only as good as that comparison.
- **Affinity is aggregate.** An overlap is a pattern across many people. It is not a prediction about any one customer, and it does not show that a partnership will sell.
- **No personal data goes to Qloo.** The agent is instructed not to send names of private individuals, emails or account identifiers, and not to help with decisions about an individual's eligibility for anything.
- **Sessions live in memory.** A server restart ends any scout in progress.

## Credits and licence

Place names for Qloo's heatmap cells come from [GeoNames](https://www.geonames.org/) data (CC BY 4.0), through the `all-the-cities` package.

Released under the [MIT licence](LICENSE).
