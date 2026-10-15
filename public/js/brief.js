// Draws the finished partnership brief.
import { $, el, list } from "./dom.js";
import { callCountText, describeCall, named } from "./log.js";

// Trend direction is calculated by the server from Qloo's population ranks.
const TRENDS = { rising: "↗ Rising in Qloo trends", falling: "↘ Falling in Qloo trends", flat: "→ No movement in Qloo trends" };

const KEY =
  "Bars, ranks and Qloo records come from Qloo. Trend direction and the shared ranking are worked out from them here. " +
  "Rationales, summaries and the pitch are the scout's reading of those results. Qloo does not show availability, fees or willingness to partner.";

const score = (value) => (typeof value === "number" ? value.toFixed(2) : undefined);

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

// "urn:entity:tv_show" reads as "tv show".
const categoryName = (urn) => String(urn ?? "").replace(/^urn:entity:/, "").replace(/_/g, " ");

const OPPORTUNITY_ROWS = 12;

// Seeds with their Qloo category, so a seed resolved as a single café rather
// than the brand is visible.
const seedNames = (scan) =>
  list(scan.seeds)
    .map((seed) => (seed.category ? `${seed.name} (${categoryName(seed.category)})` : seed.name))
    .join(", ");

const methodText = (scan) => {
  const seeds = seedNames(scan);
  const size =
    scan.prefer === "emerging" ? "less popular than the other candidates" : scan.prefer === "established" ? "more popular than the other candidates" : undefined;
  return [
    `Opportunity score, method ${scan.version}: a heuristic that ranks within this scan only.`,
    `Fit (weight ${scan.weights.fit}) is the candidate's place in Qloo's order within its own category.`,
    size && `Size (weight ${scan.weights.size}) favours candidates ${size}.`,
    `Novelty (weight ${scan.weights.novelty}) is 1 for a category other than the seeds' (${seeds}).`,
    "Missing data counts as zero.",
  ]
    .filter(Boolean)
    .join(" ");
};

const scannedText = (scan) =>
  `Scanned from ${seedNames(scan)}: ` +
  list(scan.categories)
    .map(({ category, count, error }) => `${categoryName(category)} ${error ? `(failed: ${error})` : count}`)
    .join(", ");

const placeCheck = (place) =>
  place.qloo
    ? `Qloo heatmap: near ${place.qloo.name}${place.qloo.country ? `, ${place.qloo.country}` : ""}`
    : "Not a city from a Qloo heatmap";

export const briefMarkdown = (brief) =>
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

const when = (time) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// One line per Qloo call that returned this partner, in the field log's words.
const observationLine = (observation) => {
  const placed = observation.tool === "qloo_describe" ? "found" : `#${observation.position} of ${observation.of}`;
  return [
    `${describeCall(observation.tool, named(observation.input ?? {}, observation.labels))}: ${placed}`,
    score(observation.affinity) && `affinity ${score(observation.affinity)} in this query only`,
    list(observation.drivers).length && `driven by ${observation.drivers.join(", ")}`,
    observation.at && when(observation.at),
  ]
    .filter(Boolean)
    .join(" · ");
};

const trendLine = ({ from, to }) =>
  `Qloo population rank ${from.rank.toLocaleString()} on ${from.date}, ${to.rank.toLocaleString()} on ${to.date}. A smaller rank is more popular.`;

const records = (partner) => {
  if (!partner.verified) {
    return el("p", { class: "records-none", text: "Qloo did not return this name in this scout, so nothing about it has been checked." });
  }
  const count = list(partner.observations).length;
  const lines = [
    partner.description && `Qloo describes it as: ${partner.description}`,
    ...list(partner.observations).map(observationLine),
    partner.trend?.from && trendLine(partner.trend),
  ].filter(Boolean);
  return el(
    "details",
    { class: "records" },
    el("summary", { text: `Qloo records (${count} ${count === 1 ? "call" : "calls"})` }),
    el("ul", {}, ...lines.map((line) => el("li", { text: line }))),
  );
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
        TRENDS[partner.trend?.direction] &&
          el("span", { class: "tag", "data-trend": partner.trend.direction, text: TRENDS[partner.trend.direction] }),
        matchMark(partner),
      ),
      el("dl", { class: "meters" }, meter("Affinity", partner.affinity), meter("Popularity", partner.popularity)),
      el("p", { class: "partner-why", text: partner.rationale }),
      list(partner.evidence).length && el("p", { class: "evidence-label", text: "The scout's reading" }),
      el("ul", { class: "evidence" }, ...list(partner.evidence).map((item) => el("li", { text: item }))),
      records(partner),
    ),
  );

const cell = (value) => el("td", { text: value === undefined ? "–" : String(value) });

// The cross-category scan as a table: every number is a Qloo value or our
// documented calculation from one.
const opportunitiesSection = (scan, partners) => {
  const chosen = new Set(partners.map((partner) => String(partner.id ?? "").toUpperCase()));
  const rows = list(scan.candidates).slice(0, OPPORTUNITY_ROWS);
  return section(
    "Across categories",
    el("p", { class: "basis", text: scannedText(scan) }),
    rows.length
      ? el(
          "div",
          { class: "table-wrap" },
          el(
            "table",
            { class: "opportunities" },
            el("caption", { text: `Top ${rows.length} of ${list(scan.candidates).length} candidates by opportunity score` }),
            el(
              "thead",
              {},
              el("tr", {}, ...["", "Candidate", "Category", "Qloo order", "Popularity", "Fit", "Size", "Novelty", "Score"].map((head) => el("th", { scope: "col", text: head }))),
            ),
            el(
              "tbody",
              {},
              ...rows.map((candidate, index) =>
                el(
                  "tr",
                  { "data-chosen": chosen.has(String(candidate.id).toUpperCase()) ? "true" : undefined },
                  cell(index + 1),
                  el(
                    "th",
                    { scope: "row" },
                    candidate.name,
                    chosen.has(String(candidate.id).toUpperCase()) && el("span", { class: "tag match", text: " · in your partners" }),
                    list(candidate.missing).length && el("span", { class: "tag", text: ` · missing ${candidate.missing.join(", ")}` }),
                  ),
                  cell(categoryName(candidate.category)),
                  cell(`#${candidate.position} of ${candidate.of}`),
                  cell(score(candidate.popularity)),
                  cell(score(candidate.fit)),
                  cell(score(candidate.size)),
                  cell(candidate.novelty === undefined ? undefined : candidate.novelty ? "yes" : "no"),
                  el("td", {}, el("b", { text: score(candidate.score) })),
                ),
              ),
            ),
          ),
        )
      : el("p", { text: "The scan returned no candidates." }),
    el("p", { class: "basis", text: methodText(scan) }),
  );
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
      el("p", { class: "key", text: KEY }),
      section("Your audience", el("p", { text: brief.audience_summary })),
      partners.length &&
        section("Partners, ranked", basisNote(brief), el("ol", { class: "partners" }, ...partners.map(renderPartner))),
      brief.opportunities && opportunitiesSection(brief.opportunities, partners),
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
