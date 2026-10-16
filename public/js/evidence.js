// Pieces every tab of a finished scout uses: numbers, Qloo records, photos.
import { el, list } from "./dom.js";
import { describeCall, named } from "./log.js";

// Trend direction is calculated by the server from Qloo's population ranks.
export const TRENDS = { rising: "↗ Rising in Qloo trends", falling: "↘ Falling in Qloo trends", flat: "→ No movement in Qloo trends" };

export const score = (value) => (typeof value === "number" ? value.toFixed(2) : undefined);

// "urn:entity:tv_show" reads as "tv show".
export const categoryName = (urn) => String(urn ?? "").replace(/^urn:entity:/, "").replace(/_/g, " ");

export const section = (title, ...children) => el("section", {}, el("h3", { text: title }), ...children);

// A button that copies text and confirms it in its own label.
export const copyButton = (className, label, done, getText) => {
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

const initial = (name) => el("span", { class: "partner-photo initial", text: name.trim().charAt(0).toUpperCase(), "aria-hidden": "true" });

export const photo = (name, image) => {
  if (!image) return initial(name);
  const node = el("img", { class: "partner-photo", src: image, alt: "", loading: "lazy", referrerPolicy: "no-referrer" });
  node.onerror = () => node.replaceWith(initial(name));
  return node;
};

export const matchMark = (verified) => {
  if (verified === true) return el("span", { class: "tag match", text: "✓ Matched in Qloo" });
  if (verified === false) return el("span", { class: "tag no-match", text: "Not found in Qloo's results" });
  return undefined;
};

const when = (time) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// One line per Qloo call that returned an entity, in the field log's words.
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

// Everything Qloo returned about one entity in this scout. `subject` is a
// grounded partner or plan: verified, description, observations, trend.
export const records = (subject) => {
  if (!subject.verified) {
    return el("p", { class: "records-none", text: "Qloo did not return this name in this scout, so nothing about it has been checked." });
  }
  const count = list(subject.observations).length;
  const lines = [
    subject.description && `Qloo describes it as: ${subject.description}`,
    ...list(subject.observations).map(observationLine),
    subject.trend?.from && trendLine(subject.trend),
  ].filter(Boolean);
  return el(
    "details",
    { class: "records" },
    el("summary", { text: `Qloo records (${count} ${count === 1 ? "call" : "calls"})` }),
    el("ul", {}, ...lines.map((line) => el("li", { text: line }))),
  );
};
