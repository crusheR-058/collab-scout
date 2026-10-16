// Audience DNA tab: the seeds' audience as Qloo describes it. Everything here
// is a Qloo result from the scan, grouped and labelled; nothing is written by
// the model, and what Qloo did not return is listed as a gap.
import { el, list } from "./dom.js";
import { categoryName, section } from "./evidence.js";
import { seedNames } from "./radar.js";

// "urn:tag:genre:music" belongs to music; its kind is genre.
const tagDomain = (type) => String(type).split(":").at(-1) || "other";
const tagKind = (type) => String(type).split(":")[2]?.replace(/_/g, " ") ?? "tag";

// "25_to_29" reads as "25–29"; "55_and_older" as "55 and older".
const band = (key) => key.replace(/_to_/, "–").replace(/_/g, " ");
const GENDER = { male: "Men", female: "Women" };
const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;

// Bars grow left or right from Qloo's baseline; position carries the sign.
const skewRows = (title, values, label) =>
  Object.keys(values).length > 0 &&
  el(
    "div",
    { class: "skews" },
    el("h4", { text: title }),
    ...Object.entries(values).map(([key, value]) => {
      const bar = el("i", {});
      const reach = `${Math.min(Math.abs(value), 1) * 50}%`;
      bar.style.width = reach;
      if (value >= 0) bar.style.left = "50%";
      else bar.style.right = "50%";
      return el(
        "div",
        { class: "skew" },
        el("span", { class: "skew-label", text: label(key) }),
        el("span", { class: "skew-track", "aria-hidden": "true" }, bar),
        el("b", { text: signed(value) }),
      );
    }),
  );

export const dnaTab = (scan) => {
  const profile = scan.profile;
  if (!profile) return section("Audience DNA", el("p", { text: "This scout was saved before audience profiles were added." }));

  const tags = list(profile.tags?.items);
  const domains = new Map();
  for (const tag of tags) domains.set(tagDomain(tag.type), [...(domains.get(tagDomain(tag.type)) ?? []), tag]);

  const demographics = profile.demographics ?? {};
  const hasAudience = Object.keys(demographics.age ?? {}).length + Object.keys(demographics.gender ?? {}).length > 0;

  // The first result in each category, in Qloo's own order.
  const tops = list(scan.categories)
    .map(({ category }) => list(scan.candidates).find((candidate) => categoryName(candidate.category) === categoryName(category) && candidate.position === 1))
    .filter(Boolean);

  const gaps = [
    `This profile reads the audience through ${seedNames(scan)}. If that is not your own brand, it describes the audience of the names you gave.`,
    !tags.length && `Qloo returned no tags for the seeds${profile.tags?.error ? ` (failed: ${profile.tags.error})` : ""}.`,
    !hasAudience && `Qloo returned no age or gender skew${demographics.error ? ` (failed: ${demographics.error})` : ""}.`,
    ...list(scan.categories)
      .filter(({ error, count }) => error || !count)
      .map(({ category, error }) => `No ${categoryName(category)} results${error ? ` (failed: ${error})` : ""}.`),
    "Qloo describes audiences in aggregate. Nothing here is about any one person, and none of it shows purchase intent.",
  ].filter(Boolean);

  return el(
    "div",
    { class: "dna" },
    el("p", { class: "key", text: "Built only from Qloo results in this scout, grouped here without any rewording. Order within each group is Qloo's." }),
    section(
      "What Qloo associates with this audience",
      tags.length
        ? el(
            "div",
            { class: "tag-groups" },
            ...[...domains].map(([domain, items]) =>
              el(
                "div",
                { class: "tag-group" },
                el("h4", { text: domain }),
                el("ul", { class: "chips" }, ...items.map((tag) => el("li", { class: "chip static", text: `${tag.name} · ${tagKind(tag.type)}` }))),
              ),
            ),
          )
        : el("p", { text: "No tags returned." }),
    ),
    section(
      "Who over- and under-indexes",
      hasAudience
        ? el(
            "div",
            {},
            el("p", {
              class: "basis",
              text: `Skew of the ${demographics.entity ?? "first seed"} audience against Qloo's baseline: right of the line means over-represented, left under-represented. These are relative indices, not shares of customers.`,
            }),
            skewRows("Age", demographics.age ?? {}, band),
            skewRows("Gender", demographics.gender ?? {}, (key) => GENDER[key] ?? key),
          )
        : el("p", { text: "No age or gender data returned." }),
    ),
    tops.length > 0 &&
      section(
        "Also liked, by category",
        el("p", { class: "basis", text: "Qloo's first result in each scanned category for this audience." }),
        el(
          "ul",
          { class: "places" },
          ...tops.map((candidate) => el("li", {}, el("strong", { text: candidate.name }), el("span", { text: categoryName(candidate.category) }))),
        ),
      ),
    section("Gaps and limits", el("ul", { class: "limits" }, ...gaps.map((gap) => el("li", { text: gap })))),
  );
};
