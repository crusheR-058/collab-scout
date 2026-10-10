// The five stages of a scout. This one list drives the start page's
// explanation, the progress stepper and the headings in the field log.
export const STAGES = [
  {
    title: "Pins down who you mean",
    text: "Matches your brand, or the well-known names it resembles, to Qloo entities and asks you when a match is unclear.",
    tools: ["qloo_describe", "qloo_find_tags"],
  },
  {
    title: "Maps your audience's taste",
    text: "Finds what the same audience likes in music, fashion, food, film and places.",
    tools: ["qloo_recommend", "qloo_entity_tags", "qloo_audience_demographics"],
  },
  {
    title: "Ranks a shortlist",
    text: "Scores every candidate partner together against your audience, so the order means something.",
    tools: ["qloo_rank", "qloo_compare_audiences"],
  },
  {
    title: "Checks momentum and place",
    text: "Looks at who is rising and where the overlap is strongest.",
    tools: ["qloo_trends", "qloo_where_popular"],
  },
  {
    title: "Writes the brief",
    text: "Ranked partners, the Qloo findings behind each one, a pitch you can send, and what the data does not show.",
    tools: [],
  },
];

export const BRIEF_STAGE = STAGES.length;

// Stage number (1-based) that a Qloo tool belongs to.
export const stageOf = (tool) => STAGES.findIndex((stage) => stage.tools.includes(tool)) + 1;
