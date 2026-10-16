// Opportunities tab: the cross-category scan as a chart and a table. Filters
// narrow both; the size preference re-ranks the same Qloo evidence with the
// same scoring code the server used, so only that one input changes.
import { el, list } from "./dom.js";
import { categoryName, score, section } from "./evidence.js";
import { PREFERENCES, rankCandidates } from "./opportunities.js";

const PREFER_LABELS = { either: "Any size", emerging: "Emerging", established: "Established" };
const ROWS = 12;
const W = 640;
const H = 340;
const M = { top: 32, right: 20, bottom: 52, left: 56 };
// Dots at 0 or 1 sit this far inside the frame, not on it.
const INSET = 12;

const idKey = (candidate) => String(candidate.id).toUpperCase();

const svg = (tag, attributes = {}, ...children) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined) node.setAttribute(name, value);
  node.append(...children.filter(Boolean));
  return node;
};

const sizeWords = (prefer) =>
  prefer === "emerging" ? "less popular than the other candidates" : prefer === "established" ? "more popular than the other candidates" : undefined;

// Seeds with their Qloo category, so a seed resolved as a single café rather
// than the brand is visible.
export const seedNames = (scan) =>
  list(scan.seeds)
    .map((seed) => (seed.category ? `${seed.name} (${categoryName(seed.category)})` : seed.name))
    .join(", ");

export const methodText = (scan, prefer = scan.prefer, weights = scan.weights) =>
  [
    `Opportunity score, method ${scan.version}: a heuristic that ranks within this scan only.`,
    `Fit (weight ${weights.fit}) is the candidate's place in Qloo's order within its own category.`,
    sizeWords(prefer) && `Size (weight ${weights.size}) favours candidates ${sizeWords(prefer)}.`,
    `Novelty (weight ${weights.novelty}) is 1 for a category other than the seeds' (${seedNames(scan)}).`,
    "Missing data counts as zero.",
  ]
    .filter(Boolean)
    .join(" ");

export const scannedText = (scan) =>
  `Scanned from ${seedNames(scan)}, ${scan.location ? `audience in ${scan.location}` : "no location signal (a global audience)"}` +
  `${scan.city ? `, venues in ${scan.city}` : list(scan.categories).some(({ category }) => category === "place") ? ", venues anywhere" : ""}: ` +
  list(scan.categories)
    .map(({ category, count, error }) => `${categoryName(category)} ${error ? `(failed: ${error})` : count}`)
    .join(", ");

// Fit against popularity rank: two measured dimensions, no invented distance.
const chart = (rows, { chosen, selected, onSelect }) => {
  const x = (value) => M.left + INSET + value * (W - M.left - M.right - 2 * INSET);
  const y = (value) => H - M.bottom - INSET - value * (H - M.top - M.bottom - 2 * INSET);
  const placed = rows.filter((candidate) => candidate.popularity_rank !== undefined);
  // Partners last, so they sit on top.
  placed.sort((a, b) => Number(chosen.has(idKey(a))) - Number(chosen.has(idKey(b))));

  const tip = el("div", { class: "radar-tip", role: "presentation", hidden: true });
  const show = (candidate, dot) => {
    tip.replaceChildren(
      el("strong", { text: candidate.name }),
      el("span", { text: `${categoryName(candidate.category)} · #${candidate.position} of ${candidate.of} in Qloo's order` }),
      el("span", { text: `Popularity ${score(candidate.popularity)} · score ${score(candidate.score)}` }),
    );
    tip.hidden = false;
    const box = dot.getBoundingClientRect();
    const frame = tip.parentElement.getBoundingClientRect();
    tip.style.left = `${Math.min(box.left - frame.left + 14, frame.width - 220)}px`;
    tip.style.top = `${Math.max(box.top - frame.top - 12, 0)}px`;
  };

  const ticks = [0, 0.5, 1];
  const plot = svg(
    "svg",
    {
      viewBox: `0 0 ${W} ${H}`,
      class: "radar-chart",
      role: "img",
      "aria-label": `${placed.length} candidates by fit and popularity. The table below lists the same candidates.`,
    },
    ...ticks.map((tick) => svg("line", { class: "grid", x1: x(tick), x2: x(tick), y1: y(0) + INSET, y2: y(1) - INSET })),
    ...ticks.map((tick) => svg("line", { class: "grid", x1: x(0) - INSET, x2: x(1) + INSET, y1: y(tick), y2: y(tick) })),
    ...ticks.map((tick) => svg("text", { class: "tick", x: x(0) - INSET - 8, y: y(tick) + 4, "text-anchor": "end" }, String(tick))),
    svg("text", { class: "axis", x: x(0), y: H - 14 }, "← Less popular"),
    svg("text", { class: "axis", x: x(1), y: H - 14, "text-anchor": "end" }, "More popular →"),
    svg("text", { class: "axis", x: x(0.5), y: H - 14, "text-anchor": "middle" }, "Popularity rank among these candidates"),
    svg("text", { class: "axis", transform: `translate(16 ${y(0.5)}) rotate(-90)`, "text-anchor": "middle" }, "Fit: place in Qloo's order"),
    // Above the plot, so they never cover a dot.
    svg("text", { class: "corner", x: x(0) - INSET, y: M.top - 10 }, "Strong fit, less known"),
    svg("text", { class: "corner", x: x(1) + INSET, y: M.top - 10, "text-anchor": "end" }, "Strong fit, well known"),
    ...placed.map((candidate) => {
      const [cx, cy] = [x(candidate.popularity_rank), y(candidate.fit)];
      const dot = svg("circle", { class: "dot", cx, cy, r: 5, "data-chosen": chosen.has(idKey(candidate)) ? "true" : undefined });
      // The hit area is larger than the mark.
      const hit = svg("circle", { class: "hit", cx, cy, r: 11 });
      hit.addEventListener("mouseenter", () => show(candidate, dot));
      hit.addEventListener("mouseleave", () => (tip.hidden = true));
      hit.addEventListener("click", () => onSelect(idKey(candidate)));
      return svg("g", {}, selected === idKey(candidate) && svg("circle", { class: "ring", cx, cy, r: 9 }), dot, hit);
    }),
  );
  const unplaced = rows.length - placed.length;
  return el(
    "figure",
    { class: "radar-figure" },
    el(
      "div",
      { class: "radar-legend" },
      el("span", { class: "key-dot", "data-chosen": "true" }),
      el("span", { text: "In your partners" }),
      el("span", { class: "key-dot" }),
      el("span", { text: "Other candidates" }),
    ),
    el("div", { class: "radar-frame" }, plot, tip),
    el("figcaption", {
      text:
        "Each dot is a candidate from the scan. Up is higher in Qloo's order for its own category; right is more popular than the other candidates. " +
        "Positions are ranks, not distances between tastes." +
        (unplaced ? ` ${unplaced} ${unplaced === 1 ? "candidate" : "candidates"} without a Qloo popularity ${unplaced === 1 ? "is" : "are"} not plotted.` : ""),
    }),
  );
};

const detail = (candidate, { rank, total, originalRank, prefer, weights, chosen, onPlan }) => {
  if (!candidate) return el("p", { class: "basis", text: "Select a dot or a name in the table to see why it ranks where it does." });
  const parts = [
    ["Fit", candidate.fit, weights.fit],
    weights.size !== undefined && ["Size", candidate.size, weights.size],
    ["Novelty", candidate.novelty, weights.novelty],
  ].filter(Boolean);
  return el(
    "div",
    { class: "radar-detail", "aria-live": "polite" },
    el(
      "div",
      { class: "partner-head" },
      el("span", { class: "partner-name", text: candidate.name }),
      el("span", { class: "tag", text: categoryName(candidate.category) }),
      chosen && el("span", { class: "tag chosen", text: "In your partners" }),
    ),
    el(
      "dl",
      { class: "facts" },
      el("dt", { text: "Qloo order" }),
      el("dd", { text: `#${candidate.position} of ${candidate.of} ${categoryName(candidate.category)} results` }),
      el("dt", { text: "Affinity" }),
      el("dd", { text: candidate.affinity === undefined ? "Not returned" : `${score(candidate.affinity)}, in this query only` }),
      el("dt", { text: "Popularity" }),
      el("dd", {
        text: candidate.popularity === undefined ? "Not returned" : `${score(candidate.popularity)}, rank ${score(candidate.popularity_rank)} among these candidates`,
      }),
      el("dt", { text: "Rank" }),
      el("dd", {
        text: `#${rank} of ${total} for ${PREFER_LABELS[prefer].toLowerCase()}${originalRank && originalRank !== rank ? ` (#${originalRank} in the scan's own ranking)` : ""}`,
      }),
      el("dt", { text: "Score" }),
      el("dd", {
        text: `${score(candidate.score)} from ${parts.map(([name, value, weight]) => `${name.toLowerCase()} ${value === undefined ? "missing" : score(value)} at weight ${weight}`).join(", ")}`,
      }),
      list(candidate.missing).length && el("dt", { text: "Missing" }),
      list(candidate.missing).length && el("dd", { text: candidate.missing.join(", ") }),
    ),
    onPlan && el("button", { class: "primary", type: "button", text: "Plan this partnership", onclick: () => onPlan(candidate.name) }),
  );
};

const movement = (now, before) => {
  if (!before || now === before) return "–";
  return now < before ? `▲${before - now}` : `▼${now - before}`;
};

// Filters and selection per scan, so switching tabs does not reset them.
const views = new WeakMap();

export const opportunitiesTab = (scan, { partnerIds, onPlan }) => {
  const root = el("div", { class: "radar" });
  const chosen = new Set(list(partnerIds).map((id) => String(id).toUpperCase()));
  const original = new Map(list(scan.candidates).map((candidate, index) => [idKey(candidate), index + 1]));
  if (!views.has(scan)) views.set(scan, { hidden: new Set(), prefer: scan.prefer ?? "either", selected: undefined, all: false });
  const view = views.get(scan);

  const draw = () => {
    // Keep keyboard focus on the control that was used.
    const focused = document.activeElement?.dataset?.focus;
    const ranked = rankCandidates(list(scan.candidates), list(scan.seeds), view.prefer);
    const rank = new Map(ranked.candidates.map((candidate, index) => [idKey(candidate), index + 1]));
    const shown = ranked.candidates.filter((candidate) => !view.hidden.has(candidate.category));
    const rows = view.all ? shown : shown.slice(0, ROWS);
    const selected = ranked.candidates.find((candidate) => idKey(candidate) === view.selected);
    const changed = view.prefer !== (scan.prefer ?? "either");
    const categories = [...new Set(list(scan.candidates).map((candidate) => candidate.category))];
    const select = (id) => {
      view.selected = id;
      draw();
    };

    // replaceChildren would print `false` and `0`, so drop them first.
    const parts = [
      el("p", { class: "basis", text: scannedText(scan) }),
      el(
        "div",
        { class: "radar-controls" },
        el(
          "div",
          { class: "chips", role: "group", "aria-label": "Categories shown" },
          ...categories.map((category) =>
            el("button", {
              class: "chip",
              type: "button",
              "aria-pressed": String(!view.hidden.has(category)),
              "data-focus": `category-${category}`,
              text: `${categoryName(category)} ${list(scan.candidates).filter((candidate) => candidate.category === category).length}`,
              onclick: () => {
                if (view.hidden.has(category)) view.hidden.delete(category);
                else view.hidden.add(category);
                draw();
              },
            }),
          ),
        ),
        el(
          "div",
          { class: "segmented", role: "group", "aria-label": "Rank for partner size" },
          ...PREFERENCES.map((prefer) =>
            el("button", {
              type: "button",
              "aria-pressed": String(view.prefer === prefer),
              "data-focus": `prefer-${prefer}`,
              text: PREFER_LABELS[prefer],
              onclick: () => {
                view.prefer = prefer;
                draw();
              },
            }),
          ),
        ),
      ),
      changed &&
        el("p", {
          class: "key",
          text:
            `Ranked for ${PREFER_LABELS[view.prefer].toLowerCase()} partners; the scan ranked for ${PREFER_LABELS[scan.prefer ?? "either"].toLowerCase()}. ` +
            "Only that preference changed. The Qloo evidence is the same, so any movement comes from the weighting, not from new data.",
        }),
      shown.length ? chart(shown, { chosen, selected: view.selected, onSelect: select }) : el("p", { text: "No candidates in the chosen categories." }),
      detail(selected, {
        rank: selected && rank.get(idKey(selected)),
        total: ranked.candidates.length,
        originalRank: selected && original.get(idKey(selected)),
        prefer: view.prefer,
        weights: ranked.weights,
        chosen: selected && chosen.has(idKey(selected)),
        onPlan,
      }),
      shown.length &&
        el(
          "div",
          { class: "table-wrap" },
          el(
            "table",
            { class: "opportunities" },
            el("caption", { text: `${rows.length} of ${shown.length} candidates shown, by opportunity score` }),
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                ...["#", changed ? "Moved" : undefined, "Candidate", "Category", "Qloo order", "Popularity", "Fit", "Size", "Novelty", "Score"]
                  .filter((head) => head !== undefined)
                  .map((head) => el("th", { scope: "col", text: head })),
              ),
            ),
            el(
              "tbody",
              {},
              ...rows.map((candidate) => {
                const id = idKey(candidate);
                return el(
                  "tr",
                  { "data-chosen": chosen.has(id) ? "true" : undefined, "data-selected": view.selected === id ? "true" : undefined },
                  el("td", { text: String(rank.get(id)) }),
                  changed && el("td", { text: movement(rank.get(id), original.get(id)) }),
                  el(
                    "th",
                    { scope: "row" },
                    el("button", { class: "link", type: "button", "data-focus": `select-${id}`, text: candidate.name, onclick: () => select(id) }),
                    chosen.has(id) && el("span", { class: "tag chosen", text: " · in your partners" }),
                    list(candidate.missing).length && el("span", { class: "tag", text: ` · missing ${candidate.missing.join(", ")}` }),
                  ),
                  el("td", { text: categoryName(candidate.category) }),
                  el("td", { text: `#${candidate.position} of ${candidate.of}` }),
                  el("td", { text: score(candidate.popularity) ?? "–" }),
                  el("td", { text: score(candidate.fit) }),
                  el("td", { text: score(candidate.size) ?? "–" }),
                  el("td", { text: candidate.novelty === undefined ? "–" : candidate.novelty ? "yes" : "no" }),
                  el("td", {}, el("b", { text: score(candidate.score) })),
                );
              }),
            ),
          ),
        ),
      shown.length > ROWS &&
        el("button", {
          class: "quiet",
          type: "button",
          "data-focus": "all",
          text: view.all ? `Show the top ${ROWS}` : `Show all ${shown.length}`,
          onclick: () => {
            view.all = !view.all;
            draw();
          },
        }),
      el("p", { class: "basis", text: methodText(scan, view.prefer, ranked.weights) }),
    ];
    root.replaceChildren(...parts.filter(Boolean));
    if (focused) root.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
  };

  draw();
  return section("Opportunities across categories", root);
};
