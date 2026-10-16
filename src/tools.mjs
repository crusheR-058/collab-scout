// Tools the model sees: Qloo's MCP tools plus three that the app handles itself.
import { CATEGORIES, MAX_CATEGORIES, PREFERENCES } from "./opportunities.mjs";
import { listQlooTools } from "./qloo.mjs";

export const ASK_USER = "ask_user";
export const DELIVER_BRIEF = "deliver_brief";
export const SCAN_OPPORTUNITIES = "scan_opportunities";

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

const scanOpportunities = {
  name: SCAN_OPPORTUNITIES,
  description:
    "Scan several Qloo categories at once for what the seed audience likes, and get one ranked table of " +
    "candidates across categories. The app runs one qloo_recommend per category and scores each candidate " +
    "with a fixed method: fit (its place in Qloo's order within its category), size (popularity against the " +
    "other candidates, by preference) and novelty (a category other than the seeds'). The scores are " +
    "heuristic and only rank within this scan; compare a shortlist with qloo_rank.",
  inputSchema: {
    type: "object",
    required: ["seeds", "categories"],
    properties: {
      seeds: {
        type: "array",
        items: { type: "string" },
        description: "1 to 5 Qloo entity IDs for entities already resolved in this scout, such as with qloo_describe.",
      },
      categories: {
        type: "array",
        items: { type: "string", enum: CATEGORIES },
        description: `1 to ${MAX_CATEGORIES} Qloo entity types to scan: the partner type the user wants, plus others worth exploring.`,
      },
      prefer: {
        type: "string",
        enum: PREFERENCES,
        description: "emerging favours less popular candidates, established more popular ones, either ignores popularity. Default either.",
      },
      signal_location: { type: "string", description: "Optional place that shifts which audience Qloo weighs." },
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
              description:
                "Specific Qloo findings behind the rationale. The app attaches Qloo's own scores, " +
                "trend and records to each partner by name, so use the exact name Qloo returned.",
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
      pitch: {
        type: "string",
        description: "A short outreach pitch addressed to the first partner in the list, and to no one else.",
      },
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
  [...(await listQlooTools()), askUser, scanOpportunities, deliverBrief].map(toolSpec);
