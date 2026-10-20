// Plans tab (Partnership Studio): a plan per chosen partner, written by the
// scout from this scout's Qloo results. The partner's Qloo records sit beside
// the plan so its fit claims can be checked; everything else is a suggestion.
import { el, list } from "./dom.js";
import { categoryName, copyButton, matchMark, photo, records, section } from "./evidence.js";

const bullets = (items) => el("ul", { class: "limits" }, ...list(items).map((item) => el("li", { text: item })));

export const planMarkdown = (plan, brand) =>
  [
    `# Partnership plan: ${brand} × ${plan.partner}`,
    plan.verified ? "_Partner matched in Qloo's results for this scout._" : "_Partner not found in Qloo's results for this scout._",
    "_Written by the scout from this scout's Qloo results: a starting point to check, not a verified plan._",
    `## Concept\n${plan.concept}`,
    `## Why it might fit\n${list(plan.fit_evidence).map((item) => `- ${item}`).join("\n")}`,
    `## Audience hypothesis\n${plan.audience_hypothesis}`,
    `## Value\n- For ${brand}: ${plan.value_for_you}\n- For ${plan.partner}: ${plan.value_for_partner}`,
    ...[
      ["Formats", plan.formats],
      ["Practical considerations", plan.considerations],
      ["Risks and unknowns", plan.risks],
      ["Before you reach out", plan.questions],
      ["Next research", plan.next_research],
    ].map(([title, items]) => `## ${title}\n${list(items).map((item) => `- ${item}`).join("\n")}`),
    `## Validation plan\n${list(plan.validation)
      .map((step) => `- **${step.test}**: measure ${step.measure}; success looks like ${step.success}`)
      .join("\n")}`,
    plan.outreach_message && `## First message\n${plan.outreach_message}`,
  ]
    .filter(Boolean)
    .join("\n\n");

const refinePlan = (plan, onPlan) => {
  const input = el("input", { id: "plan-refine", type: "text", autocomplete: "off", maxLength: 500, placeholder: "Make it a small event instead, or cut the budget" });
  return el(
    "form",
    {
      class: "refine",
      onsubmit: (event) => {
        event.preventDefault();
        if (input.value.trim()) onPlan(plan.partner, input.value.trim());
      },
    },
    el("label", { htmlFor: "plan-refine", text: "Ask for a change to this plan" }),
    el("div", { class: "answer-row" }, input, el("button", { class: "primary", type: "submit", text: "Revise plan" })),
    el("p", { class: "form-hint", id: "plan-hint", role: "status" }),
  );
};

const planView = (plan, { brand, onPlan }) =>
  el(
    "article",
    { class: "plan" },
    el(
      "div",
      { class: "plan-head" },
      photo(plan.partner, plan.image),
      el(
        "div",
        {},
        el("h3", { text: `${brand} × ${plan.partner}` }),
        el(
          "div",
          { class: "partner-head" },
          plan.category && el("span", { class: "tag", text: categoryName(plan.category) }),
          matchMark(plan.verified),
        ),
      ),
    ),
    el("p", { class: "key", text: "Written by the scout from this scout's Qloo results. A starting point to check, not a verified plan. Nothing here means the partner has agreed to anything." }),
    section("Concept", el("p", { text: plan.concept })),
    section(
      "Why it might fit",
      el("p", { class: "evidence-label", text: "The scout's reading of Qloo's results" }),
      el("ul", { class: "evidence" }, ...list(plan.fit_evidence).map((item) => el("li", { text: item }))),
      records(plan),
    ),
    section("Audience hypothesis", el("p", { text: plan.audience_hypothesis })),
    section(
      "Value for each side",
      el("dl", { class: "facts" }, el("dt", { text: brand }), el("dd", { text: plan.value_for_you }), el("dt", { text: plan.partner }), el("dd", { text: plan.value_for_partner })),
    ),
    section("Formats", bullets(plan.formats)),
    section("Practical considerations", bullets(plan.considerations)),
    section("Risks and unknowns", bullets(plan.risks)),
    section("Before you reach out", bullets(plan.questions)),
    section("Next research", bullets(plan.next_research)),
    section(
      "Validation plan",
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          { class: "opportunities steps-table" },
          el("thead", {}, el("tr", {}, ...["Test", "Measure", "Success looks like"].map((head) => el("th", { scope: "col", text: head })))),
          el(
            "tbody",
            {},
            ...list(plan.validation).map((step) => el("tr", {}, el("th", { scope: "row", text: step.test }), el("td", { text: step.measure }), el("td", { text: step.success }))),
          ),
        ),
      ),
    ),
    plan.outreach_message &&
      section(
        "A first message to send",
        el("p", { class: "key", text: "Written by the scout. Check every claim, and add the right contact yourself; Qloo has no contact details." }),
        el("p", { class: "pitch", text: plan.outreach_message }),
        copyButton("quiet copy-pitch", "Copy message", "Message copied", () => plan.outreach_message),
      ),
    el(
      "div",
      { class: "form-row" },
      copyButton("primary", "Copy plan", "Plan copied", () => planMarkdown(plan, brand)),
    ),
    onPlan && refinePlan(plan, onPlan),
  );

// Side by side, the parts that differ most between concepts.
const compare = (plans) =>
  el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      { class: "opportunities compare" },
      el("caption", { text: "Plans side by side" }),
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "" }), ...plans.map((plan) => el("th", { scope: "col", text: plan.partner })))),
      el(
        "tbody",
        {},
        ...[
          ["In Qloo", (plan) => (plan.verified ? "Matched" : "Not found")],
          ["Concept", (plan) => plan.concept],
          ["Formats", (plan) => list(plan.formats).join("; ")],
          ["Main risks", (plan) => list(plan.risks).slice(0, 3).join("; ")],
          ["First test", (plan) => list(plan.validation)[0]?.test ?? "–"],
        ].map(([label, value]) => el("tr", {}, el("th", { scope: "row", text: label }), ...plans.map((plan) => el("td", { text: value(plan) })))),
      ),
    ),
  );

// `open` is the partner whose plan is shown; `candidates` are partners a plan
// can be started for from here.
export const plansTab = (plans, { brand, open, candidates, onPlan, onOpen }) => {
  const current = plans.find((plan) => plan.partner === open) ?? plans[0];
  return el(
    "div",
    { class: "plans" },
    onPlan &&
      candidates.length > 0 &&
      section(
        plans.length ? "Plan another partner" : "Plan a partnership",
        el("p", { class: "basis", text: "The scout writes a plan from what Qloo returned in this scout. It counts as one of this scout's revisions." }),
        el(
          "div",
          { class: "chips" },
          ...candidates.map((name) => el("button", { class: "chip", type: "button", text: name, onclick: () => onPlan(name) })),
        ),
      ),
    !plans.length && !onPlan && el("p", { text: "This scout has no plans, and its live session has ended." }),
    plans.length > 1 &&
      el(
        "div",
        { class: "segmented", role: "group", "aria-label": "Plans" },
        ...plans.map((plan) =>
          el("button", { type: "button", "aria-pressed": String(plan === current), text: plan.partner, onclick: () => onOpen(plan.partner) }),
        ),
      ),
    plans.length > 1 && compare(plans),
    current && planView(current, { brand, onPlan }),
  );
};
