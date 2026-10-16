// Compare: the same scan run again by the server for another market, or with
// one more name in the audience, beside this scout's own table.
import { el } from "./dom.js";
import { categoryName, score, section } from "./evidence.js";
import { scannedText } from "./radar.js";

const ROWS = 10;

const top = (scan) => scan.candidates.slice(0, ROWS);

// The two top tens in one table; a name in both is marked, by Qloo ID.
const sideBySide = (mine, theirs) => {
  const ids = (scan) => new Set(top(scan).map((candidate) => String(candidate.id).toUpperCase()));
  const [inMine, inTheirs] = [ids(mine), ids(theirs)];
  const cell = (candidate, other) =>
    el(
      "td",
      {},
      candidate ? `${candidate.name} (${categoryName(candidate.category)}, ${score(candidate.score)})` : "–",
      candidate && other.has(String(candidate.id).toUpperCase()) && el("span", { class: "tag", text: "in both" }),
    );
  return el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      { class: "opportunities compare" },
      el("caption", { text: `Top ${ROWS} by opportunity score in each scan` }),
      el("thead", {}, el("tr", {}, ...["#", "This scout", "Comparison"].map((head) => el("th", { scope: "col", text: head })))),
      el(
        "tbody",
        {},
        ...Array.from({ length: Math.max(top(mine).length, top(theirs).length) }, (_, index) =>
          el("tr", {}, el("th", { scope: "row", text: String(index + 1) }), cell(top(mine)[index], inTheirs), cell(top(theirs)[index], inMine)),
        ),
      ),
    ),
  );
};

export const compareSection = (scan, onCompare) => {
  const market = el("input", { id: "compare-market", type: "text", autocomplete: "off", maxLength: 100, placeholder: "Delhi" });
  const add = el("input", { id: "compare-add", type: "text", autocomplete: "off", maxLength: 200, placeholder: "Another brand your audience loves" });
  const result = el("div", { role: "status" });
  const button = el("button", { class: "primary", type: "submit", text: "Compare" });
  const form = el(
    "form",
    {
      class: "refine compare-form",
      onsubmit: async (event) => {
        event.preventDefault();
        if (!market.value.trim() && !add.value.trim()) {
          result.replaceChildren(el("p", { class: "form-hint", text: "Give a market, a name to add, or both." }));
          return;
        }
        button.disabled = true;
        result.replaceChildren(el("p", { class: "basis", text: "Running the scan again with Qloo…" }));
        try {
          const { scan: theirs, added } = await onCompare({ market: market.value.trim(), add: add.value.trim() });
          const parts = [
            added &&
              el("p", {
                class: "basis",
                text:
                  `Qloo read “${add.value.trim()}” as ${added.name}${added.category ? ` (${categoryName(added.category)})` : ""}` +
                  `${added.of ? `, the most popular of ${added.of} matches. If that is not who you mean, add a more specific name.` : "."}`,
              }),
            el("p", { class: "basis", text: `This scout: ${scannedText(scan)}` }),
            el("p", { class: "basis", text: `Comparison: ${scannedText(theirs)}` }),
            sideBySide(scan, theirs),
            el("p", { class: "basis", text: "Scores rank within their own scan, so compare positions and overlap, not the numbers across the two." }),
          ];
          // replaceChildren would print `undefined`, so drop it first.
          result.replaceChildren(...parts.filter(Boolean));
        } catch (error) {
          result.replaceChildren(el("p", { class: "form-hint", text: error.message }));
        }
        button.disabled = false;
      },
    },
    el("label", { htmlFor: "compare-market", text: "Another market" }),
    market,
    el("label", { htmlFor: "compare-add", text: "Add a name to the audience" }),
    el("div", { class: "answer-row" }, add, button),
  );
  return section(
    "Compare",
    el("p", { class: "basis", text: "Runs this scan again with Qloo, not the scout: for another market, with one more name your audience loves, or both. It counts toward your hourly scouts." }),
    form,
    result,
  );
};
