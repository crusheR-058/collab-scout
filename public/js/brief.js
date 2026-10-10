// Draws the finished partnership brief.
import { $, el, list } from "./dom.js";
import { callCountText } from "./log.js";

const TRENDS = { rising: "↗ Rising", steady: "→ Steady", falling: "↘ Falling" };

const partnerLine = (partner, index) =>
  [
    `${index + 1}. **${partner.name}** (${partner.type})`,
    `   ${partner.rationale}`,
    ...list(partner.evidence).map((item) => `   - ${item}`),
  ].join("\n");

export const briefMarkdown = (brief) =>
  [
    `# ${brief.brand} × ${brief.partners[0]?.name ?? "no match"}`,
    brief.goal,
    `## Your audience\n${brief.audience_summary}`,
    `## Partners\n${brief.partners.map(partnerLine).join("\n")}`,
    list(brief.locations).length &&
      `## Where\n${brief.locations.map((place) => `- **${place.name}**: ${place.rationale}`).join("\n")}`,
    `## Pitch\n${brief.pitch}`,
    `## What this does not show\n${list(brief.limitations)
      .map((item) => `- ${item}`)
      .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

// A button that copies text and confirms it in its own label.
const copyButton = (className, label, done, getText) => {
  const button = el("button", {
    class: className,
    type: "button",
    text: label,
    onclick: async () => {
      await navigator.clipboard.writeText(getText());
      button.textContent = done;
      setTimeout(() => (button.textContent = label), 2000);
    },
  });
  return button;
};

const section = (title, ...children) => el("section", {}, el("h3", { text: title }), ...children);

const initial = (name) => el("span", { class: "partner-photo initial", text: name.trim().charAt(0).toUpperCase(), "aria-hidden": "true" });

const photo = (partner) => {
  if (!partner.image) return initial(partner.name);
  const image = el("img", {
    class: "partner-photo",
    src: partner.image,
    alt: "",
    loading: "lazy",
    referrerPolicy: "no-referrer",
  });
  image.onerror = () => image.replaceWith(initial(partner.name));
  return image;
};

const meter = (label, value) =>
  typeof value === "number" &&
  el(
    "div",
    { class: "meter-row" },
    el("dt", { text: label }),
    el(
      "dd",
      {},
      el("span", { class: "meter" }, el("i", { style: `width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` })),
      el("b", { text: value.toFixed(2) }),
    ),
  );

const matchMark = (partner) => {
  if (partner.verified === true) return el("span", { class: "tag match", text: "✓ Matched in Qloo" });
  if (partner.verified === false) return el("span", { class: "tag no-match", text: "Not found in Qloo's results" });
  return undefined;
};

const renderPartner = (partner) =>
  el(
    "li",
    { class: "partner" },
    photo(partner),
    el(
      "div",
      { class: "partner-body" },
      el(
        "div",
        { class: "partner-head" },
        el("span", { class: "partner-name", text: partner.name }),
        el("span", { class: "tag", text: partner.type }),
        TRENDS[partner.trend] && el("span", { class: "tag", "data-trend": partner.trend, text: TRENDS[partner.trend] }),
        matchMark(partner),
      ),
      el("dl", { class: "meters" }, meter("Affinity", partner.affinity), meter("Popularity", partner.popularity)),
      el("p", { class: "partner-why", text: partner.rationale }),
      list(partner.evidence).length && el("p", { class: "evidence-label", text: "From Qloo" }),
      el("ul", { class: "evidence" }, ...list(partner.evidence).map((item) => el("li", { text: item }))),
    ),
  );

const refineForm = (onRefine) => {
  const input = el("input", {
    id: "refine-input",
    type: "text",
    autocomplete: "off",
    maxLength: 500,
    placeholder: "Only lesser-known partners, or try brands instead",
  });
  return el(
    "form",
    {
      class: "refine",
      onsubmit: (event) => {
        event.preventDefault();
        if (input.value.trim()) onRefine(input.value.trim());
      },
    },
    el("label", { htmlFor: "refine-input", text: "Ask for a change" }),
    el("div", { class: "answer-row" }, input, el("button", { class: "primary", type: "submit", text: "Revise brief" })),
    el("p", { class: "form-hint", id: "refine-hint", role: "status" }),
  );
};

// `actions` says what the reader can do next: revise a live scout, or start
// again from a stored one whose server session is gone.
export const renderBrief = (brief, { onRefine, onRestart, onStartAgain }) => {
  const partners = list(brief.partners);
  const panel = $("#panel-brief");

  panel.replaceChildren(
    el(
      "header",
      { class: "lockup" },
      el("p", { class: "eyebrow", text: partners.length ? "Top match" : "No match found" }),
      el(
        "h2",
        { class: "pair", "data-arrive": "", "aria-label": `${brief.brand} and ${partners[0]?.name ?? "no match"}` },
        el("span", { class: "pair-side pair-you", text: brief.brand }),
        el("span", { class: "pair-times", text: "×", "aria-hidden": "true" }),
        el("span", { class: "pair-side pair-them", text: partners[0]?.name ?? "No one yet" }),
      ),
      el("p", { class: "brief-goal", text: brief.goal }),
    ),
    el(
      "div",
      { class: "brief-body" },
      section("Your audience", el("p", { text: brief.audience_summary })),
      partners.length && section("Partners, ranked", el("ol", { class: "partners" }, ...partners.map(renderPartner))),
      list(brief.locations).length &&
        section(
          "Where the overlap is strongest",
          el(
            "ul",
            { class: "places" },
            ...brief.locations.map((place) =>
              el("li", {}, el("strong", { text: place.name }), el("span", { text: place.rationale })),
            ),
          ),
        ),
      section(
        "A pitch you can send",
        el("p", { class: "pitch", text: brief.pitch }),
        copyButton("quiet copy-pitch", "Copy pitch", "Pitch copied", () => brief.pitch),
      ),
      section(
        "What this does not show",
        el("ul", { class: "limits" }, ...list(brief.limitations).map((item) => el("li", { text: item }))),
      ),
    ),
    onRefine
      ? refineForm(onRefine)
      : el(
          "div",
          { class: "refine" },
          el("p", { text: "This scout is saved in your browser. Its live session has ended, so it can't be revised." }),
          el("button", { class: "primary", type: "button", text: "Start again from this brief", onclick: onStartAgain }),
        ),
    el(
      "footer",
      { class: "brief-actions" },
      copyButton("primary", "Copy brief", "Brief copied", () => briefMarkdown({ ...brief, partners })),
      el("button", { class: "quiet", type: "button", text: "Print or save as PDF", onclick: () => window.print() }),
      el("button", { class: "quiet", type: "button", text: "Start a new scout", onclick: onRestart }),
      el("p", { text: `Built from the ${callCountText()} in the field log` }),
    ),
  );
};
