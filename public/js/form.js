// The start form. The guided fields compose the same plain-text brief that the
// free-text box sends, so the server sees one kind of input.
import { $, el } from "./dom.js";

const WANTS = [
  ["musician", "A musician or band", "a musician or band"],
  ["brand", "A brand", "a brand"],
  ["podcast", "A podcast", "a podcast"],
  ["place", "A venue or place", "a venue or place"],
  ["author", "An author", "an author"],
  ["screen", "A film or TV show", "a film or TV show"],
  ["game", "A video game", "a video game"],
];

const EXAMPLES = [
  {
    label: "Coffee roaster × musician",
    who: "a specialty coffee roastery",
    want: "musician",
    goal: "a limited-edition blend, ideally with an Indian independent act",
    names: "Blue Bottle Coffee",
    market: "India",
  },
  {
    label: "Lo-fi producer × clothing label",
    who: "a lo-fi hip hop producer",
    want: "brand",
    goal: "a small merch capsule with a clothing label",
    names: "Nujabes, J Dilla",
    market: "",
  },
  {
    label: "Bookshop × podcast",
    who: "an independent bookshop known for literary fiction and translated novels",
    want: "podcast",
    goal: "a monthly live recording in the shop",
    names: "Elena Ferrante, Haruki Murakami, Sally Rooney",
    market: "London",
  },
];

const FIELDS = ["who", "want", "goal", "names", "market"];
const field = (name) => $(`#f-${name}`);
const value = (name) => field(name).value.trim();

const compose = () => {
  const phrase = WANTS.find(([key]) => key === field("want").value)[2];
  return [
    `I am ${value("who")}.`,
    `I want ${phrase} to partner with${value("goal") ? ` for ${value("goal")}` : ""}.`,
    `My audience loves ${value("names")}.`,
    value("market") && `My market is ${value("market")}.`,
  ]
    .filter(Boolean)
    .join(" ");
};

const guided = () => !$("#guided").disabled;

// A disabled fieldset is skipped by validation, so only the visible mode is required.
const setMode = (mode) => {
  $("#guided").disabled = mode !== "guided";
  $("#guided").hidden = mode !== "guided";
  $("#free").disabled = mode !== "free";
  $("#free").hidden = mode !== "free";
  $("#mode-toggle").textContent = mode === "guided" ? "Write it freely instead" : "Use the guided form instead";
};

export const briefText = () => (guided() ? compose() : $("#brief").value.trim());

// Put an earlier brief back into the free-text box.
export const prefill = (text) => {
  setMode("free");
  $("#brief").value = text;
  $("#brief").focus();
};

export const focusForm = () => (guided() ? field("who") : $("#brief")).focus();

export const setupForm = (onSubmit) => {
  field("want").append(...WANTS.map(([key, label]) => el("option", { value: key, text: label })));

  $("#examples").append(
    ...EXAMPLES.map((example) =>
      el(
        "li",
        {},
        el("button", {
          class: "chip",
          type: "button",
          text: example.label,
          onclick: () => {
            setMode("guided");
            for (const name of FIELDS) field(name).value = example[name];
            field("who").focus();
          },
        }),
      ),
    ),
  );

  $("#mode-toggle").addEventListener("click", () => {
    // Carry what is already filled in across to the free-text box.
    if (guided() && value("who") && value("names") && !$("#brief").value.trim()) $("#brief").value = compose();
    setMode(guided() ? "free" : "guided");
    focusForm();
  });

  $("#brief-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = briefText();
    if (text) onSubmit(text);
  });

  setMode("guided");
};
