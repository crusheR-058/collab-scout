// Tools the model sees: Qloo's MCP tools plus two that the app handles itself.
import { listQlooTools } from "./qloo.mjs";

export const ASK_USER = "ask_user";
export const DELIVER_BRIEF = "deliver_brief";

const askUser = {
  name: ASK_USER,
  description:
    "Pause and ask the user one question. Use it to confirm which Qloo entity or tag " +
    "they mean when a match is ambiguous or a Qloo result has status needs_input, or " +
    "when the brief is missing something you cannot reasonably assume.",
  inputSchema: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string" },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Candidate answers to offer, such as the entity matches Qloo returned.",
      },
    },
  },
};

const deliverBrief = {
  name: DELIVER_BRIEF,
  description:
    "Deliver the finished partnership brief. Call it exactly once, as the last step, " +
    "and only with claims that the Qloo results in this conversation support.",
  inputSchema: {
    type: "object",
    required: ["brand", "goal", "audience_summary", "partners", "pitch", "limitations"],
    properties: {
      brand: { type: "string", description: "Who the brief is for." },
      goal: { type: "string" },
      audience_summary: {
        type: "string",
        description: "What the brand's audience likes across domains, per Qloo.",
      },
      partners: {
        type: "array",
        description: "Recommended partners, best first.",
        items: {
          type: "object",
          required: ["name", "type", "rationale", "evidence"],
          properties: {
            name: { type: "string" },
            type: { type: "string", description: "Qloo entity type, such as brand or artist." },
            rationale: { type: "string" },
            evidence: {
              type: "array",
              items: { type: "string" },
              description: "Specific Qloo findings behind the rationale.",
            },
            affinity: { type: "number", description: "Qloo affinity score for this partner, 0 to 1." },
            popularity: { type: "number", description: "Qloo popularity score, 0 to 1." },
            trend: {
              type: "string",
              enum: ["rising", "steady", "falling", "unknown"],
              description: "Only from qloo_trends data. Use unknown when the data shows no movement.",
            },
          },
        },
      },
      locations: {
        type: "array",
        description: "Where the overlap is geographically strongest, if the goal needs it.",
        items: {
          type: "object",
          required: ["name", "rationale"],
          properties: { name: { type: "string" }, rationale: { type: "string" } },
        },
      },
      pitch: { type: "string", description: "A short outreach pitch to the top partner." },
      limitations: {
        type: "array",
        items: { type: "string" },
        description: "What these results do not establish.",
      },
    },
  },
};

// Bedrock Converse tool format.
const toolSpec = ({ name, description, inputSchema }) => ({
  toolSpec: { name, description, inputSchema: { json: inputSchema } },
});

export const loadTools = async () =>
  [...(await listQlooTools()), askUser, deliverBrief].map(toolSpec);
