// Draws a finished scout: the brief, and tabs for the audience profile, the
// cross-category opportunities and partnership plans.
import { compareSection } from "./compare.js";
import { dnaTab } from "./dna.js";
import { $, el, list } from "./dom.js";
import { TRENDS, copyButton, matchMark, photo, records, score, section, categoryName } from "./evidence.js";
import { callCountText, describeCall, named } from "./log.js";
import { planMarkdown, plansTab } from "./plans.js";
import { methodText, opportunitiesTab, scannedText } from "./radar.js";
import { state } from "./state.js";

const KEY =
  "Bars, ranks and Qloo records come from Qloo. Trend direction and the shared ranking are worked out from them here. " +
  "Rationales, summaries and the pitch are the scout's reading of those results. Qloo does not show availability, fees or willingness to partner.";

const OPPORTUNITY_ROWS = 12;

const qlooLine = (partner) => {
  if (partner.verified === false) return "Not found in Qloo's results for this scout.";
  const parts = [
    score(partner.affinity) && `affinity ${score(partner.affinity)} (shared ranking)`,
    score(partner.popularity) && `popularity ${score(partner.popularity)}`,
    partner.trend?.direction && TRENDS[partner.trend.direction]?.slice(2).toLowerCase(),
  ].filter(Boolean);
  return parts.length ? `Qloo: ${parts.join(", ")}` : undefined;
};

const partnerLine = (partner, index) =>
  [
    `${index + 1}. **${partner.name}** (${partner.type})`,
    qlooLine(partner) && `   ${qlooLine(partner)}`,
    `   ${partner.rationale}`,
    ...list(partner.evidence).map((item) => `   - ${item}`),
  ]
    .filter(Boolean)
    .join("\n");

const placeCheck = (place) =>
  place.qloo
    ? `Qloo heatmap: near ${place.qloo.name}${place.qloo.country ? `, ${place.qloo.country}` : ""}`
    : "Not a city from a Qloo heatmap";

export const briefMarkdown = (brief, plans = []) =>
  [
    `# ${brief.brand} × ${brief.partners[0]?.name ?? "no match"}`,
    brief.goal,
    `## Your audience\n${brief.audience_summary}`,
    `_${KEY}_`,
    `## Partners\n${brief.partners.map(partnerLine).join("\n")}`,
    list(brief.locations).length &&
      `## Where\n${brief.locations.map((place) => `- **${place.name}**: ${place.rationale} (${placeCheck(place)})`).join("\n")}`,
    brief.opportunities &&
      `## Across categories\n${scannedText(brief.opportunities)}\n\n${list(brief.opportunities.candidates)
        .slice(0, OPPORTUNITY_ROWS)
        .map((candidate, index) => `${index + 1}. ${candidate.name} (${categoryName(candidate.category)}), score ${score(candidate.score)}`)
        .join("\n")}\n\n_${methodText(brief.opportunities)}_`,
    `## Pitch\n${brief.pitch}`,
    `## What this does not show\n${list(brief.limitations)
      .map((item) => `- ${item}`)
      .join("\n")}`,
    ...plans.map((plan) => planMarkdown(plan, brief.brand).replace(/^# /, "## ")),
  ]
    .filter(Boolean)
    .join("\n\n");

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

const renderPartner = (partner, onPlan) =>
  el(
    "li",
    { class: "partner" },
    photo(partner.name, partner.image),
    el(
      "div",
      { class: "partner-body" },
      el(
        "div",
        { class: "partner-head" },
        el("span", { class: "partner-name", text: partner.name }),
        el("span", { class: "tag", text: partner.type }),
        TRENDS[partner.trend?.direction] &&
          el("span", { class: "tag", "data-trend": partner.trend.direction, text: TRENDS[partner.trend.direction] }),
        matchMark(partner.verified),
      ),
      el("dl", { class: "meters" }, meter("Affinity", partner.affinity), meter("Popularity", partner.popularity)),
      el("p", { class: "partner-why", text: partner.rationale }),
      list(partner.evidence).length && el("p", { class: "evidence-label", text: "The scout's reading" }),
      el("ul", { class: "evidence" }, ...list(partner.evidence).map((item) => el("li", { text: item }))),
      records(partner),
      onPlan && partner.verified && el("button", { class: "quiet plan-button", type: "button", text: "Plan this partnership", onclick: () => onPlan(partner.name) }),
    ),
  );

const ARROWS = { rising: "↗ rising", falling: "↘ falling", flat: "→ no movement" };
const trendText = (trend) => (trend?.direction ? `${ARROWS[trend.direction]}, rank ${trend.to?.rank ?? "?"} on ${trend.to?.date ?? "?"}` : "no trend recorded");

// Asks Qloo for each partner's trend now, beside what the brief recorded.
const checkSection = (onCheck) => {
  const result = el("div", { role: "status" });
  const button = el("button", {
    class: "quiet check-button",
    type: "button",
    text: "Check Qloo trends now",
    onclick: async () => {
      button.disabled = true;
      result.replaceChildren(el("p", { class: "basis", text: "Asking Qloo…" }));
      try {
        const { checked, partners } = await onCheck();
        result.replaceChildren(
          el(
            "div",
            { class: "table-wrap" },
            el(
              "table",
              { class: "opportunities" },
              el("caption", { text: `Qloo's latest weekly trends, checked ${checked}` }),
              el("thead", {}, el("tr", {}, ...["Partner", "In this brief", "Now"].map((head) => el("th", { scope: "col", text: head })))),
              el(
                "tbody",
                {},
                ...partners.map((partner) =>
                  el("tr", {}, el("th", { scope: "row", text: partner.name }), el("td", { text: trendText(partner.before) }), el("td", { text: partner.problem ?? trendText(partner.now) })),
                ),
              ),
            ),
          ),
        );
      } catch (error) {
        result.replaceChildren(el("p", { class: "form-hint", text: error.message }));
      }
      button.disabled = false;
    },
  });
  return section(
    "Has anything changed?",
    el("p", { class: "basis", text: "Qloo's trend for each partner now, against the one in this brief. It uses Qloo only, not the scout, and counts toward your hourly scouts." }),
    button,
    result,
  );
};

// A read-only link anyone can open; the owner can turn it off.
const shareControl = ({ share, onShare, onUnshare }) => {
  const box = el("div", { class: "share" });
  const hint = el("p", { class: "form-hint", role: "status" });
  const attempt = (action) => async () => {
    try {
      draw(await action());
    } catch (error) {
      hint.textContent = error.message;
    }
  };
  const draw = (token) => {
    hint.textContent = "";
    if (!token) {
      box.replaceChildren(el("button", { class: "quiet", type: "button", text: "Create a share link", onclick: attempt(onShare) }), hint);
      return;
    }
    const url = `${location.origin}/s/${token}`;
    box.replaceChildren(
      el("input", { class: "share-url", type: "text", readOnly: true, value: url, "aria-label": "Share link" }),
      copyButton("quiet", "Copy link", "Link copied", () => url),
      el("button", { class: "quiet", type: "button", text: "Stop sharing", onclick: attempt(async () => (await onUnshare(), null)) }),
      el("p", { class: "basis", text: "Anyone with this link can read this brief and its plans without signing in. Your brief text and field log stay private." }),
      hint,
    );
  };
  draw(share);
  return box;
};

const download = (name, text) => {
  const link = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/markdown" })), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

// Which Qloo call the affinity bars come from, so a reader knows they compare.
const basisNote = (brief) => {
  const basis = brief.affinity_basis;
  if (!basis) return el("p", { class: "basis", text: "Qloo returned no affinity that covers these partners together, so no affinity bars are shown." });
  const call = describeCall(basis.tool, named(basis.input ?? {}, basis.labels));
  return el("p", {
    class: "basis",
    text: `Affinity bars come from one Qloo call that scored ${basis.covers} of these partners together (${call}), so they compare. Affinities from other queries are in each partner's Qloo records.`,
  });
};

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

const briefTab = (brief, partners, { onRefine, onStartAgain, onPlan, onCheck }) =>
  el(
    "div",
    {},
    el(
      "div",
      { class: "brief-body" },
      el("p", { class: "key", text: KEY }),
      section("Your audience", el("p", { text: brief.audience_summary })),
      partners.length &&
        section("Partners, ranked", basisNote(brief), el("ol", { class: "partners" }, ...partners.map((partner) => renderPartner(partner, onPlan)))),
      onCheck && partners.some((partner) => partner.verified) && checkSection(onCheck),
      list(brief.locations).length &&
        section(
          "Where the overlap is strongest",
          el(
            "ul",
            { class: "places" },
            ...brief.locations.map((place) =>
              el(
                "li",
                {},
                el("strong", { text: place.name }),
                el("span", { text: place.rationale }),
                el("small", { class: place.qloo ? "place-check" : "place-check unchecked", text: placeCheck(place) }),
              ),
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
      : onStartAgain &&
          el(
            "div",
            { class: "refine" },
            el("p", { text: "This scout is saved to your account. Its live session has ended, so it can't be revised." }),
            el("button", { class: "primary", type: "button", text: "Start again from this brief", onclick: onStartAgain }),
          ),
  );

// Tabs follow the ARIA tab pattern: arrow keys move between them.
const tabBar = (tabs, current, onSelect) => {
  const buttons = tabs.map(({ id, label }) =>
    el("button", {
      type: "button",
      role: "tab",
      id: `tab-${id}`,
      "aria-controls": `tabpanel-${id}`,
      "aria-selected": String(id === current),
      tabIndex: id === current ? 0 : -1,
      text: label,
      onclick: () => onSelect(id),
    }),
  );
  const bar = el("div", { class: "tabs", role: "tablist", "aria-label": "Parts of this scout" }, ...buttons);
  bar.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const index = (tabs.findIndex(({ id }) => id === current) + step + tabs.length) % tabs.length;
    onSelect(tabs[index].id);
    $(`#tab-${tabs[index].id}`)?.focus();
  });
  return bar;
};

// `options`: onRefine and onPlan exist only while the server holds the scout;
// onCheck, onCompare and onShare only in the app, not on a shared page;
// `tab` and `openPlan` say what to show.
export const renderBrief = (brief, options) => {
  const { onRestart, onPlan, onCompare, onShare, plans = [], tab = "brief", openPlan } = options;
  const partners = list(brief.partners);
  const panel = $("#panel-brief");
  const scan = brief.opportunities;
  const tabs = [
    { id: "brief", label: "Brief" },
    scan && { id: "dna", label: "Audience DNA" },
    scan && { id: "opportunities", label: "Opportunities" },
    (onPlan || plans.length) && { id: "plans", label: plans.length ? `Plans (${plans.length})` : "Plans" },
  ].filter(Boolean);
  const current = tabs.some(({ id }) => id === tab) ? tab : "brief";
  const rerender = (changes) => renderBrief(brief, { ...options, ...changes });
  const partnerNames = partners.filter((partner) => partner.verified).map((partner) => partner.name);

  const content = {
    brief: () => briefTab(brief, partners, options),
    dna: () => el("div", { class: "brief-body" }, dnaTab(scan)),
    opportunities: () =>
      el(
        "div",
        { class: "brief-body" },
        opportunitiesTab(scan, { partnerIds: partners.map((partner) => partner.id).filter(Boolean), onPlan }),
        onCompare && compareSection(scan, onCompare),
      ),
    plans: () =>
      el(
        "div",
        { class: "brief-body" },
        plansTab(plans, {
          brand: brief.brand,
          open: openPlan,
          candidates: partnerNames.filter((name) => !plans.some((plan) => plan.partner === name)),
          onPlan,
          onOpen: (partner) => rerender({ tab: "plans", openPlan: partner }),
        }),
      ),
  };

  const parts = [
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
    tabs.length > 1 && tabBar(tabs, current, (id) => rerender({ tab: id })),
    // Every panel is built so print and copy include them all; only one shows.
    ...tabs.map(({ id }) =>
      el("div", { role: "tabpanel", id: `tabpanel-${id}`, "aria-labelledby": `tab-${id}`, class: "tabpanel", hidden: id !== current }, content[id]()),
    ),
    el(
      "footer",
      { class: "brief-actions" },
      copyButton("primary", "Copy brief", "Brief copied", () => briefMarkdown({ ...brief, partners }, plans)),
      el("button", { class: "quiet", type: "button", text: "Print or save as PDF", onclick: () => window.print() }),
      el("button", {
        class: "quiet",
        type: "button",
        text: "Download Markdown",
        onclick: () => download(`${brief.brand} x ${partners[0]?.name ?? "brief"}.md`, briefMarkdown({ ...brief, partners }, plans)),
      }),
      onRestart && el("button", { class: "quiet", type: "button", text: "Start a new scout", onclick: onRestart }),
      state.callCount > 0 && el("p", { text: `Built from the ${callCountText()} in the field log` }),
    ),
    onShare && shareControl(options),
  ];
  // replaceChildren would print `false`, so drop it first.
  panel.replaceChildren(...parts.filter(Boolean));
};
