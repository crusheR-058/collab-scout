// The field log: every Qloo call, in plain words, with its raw detail on demand.
import { $, el, list, plain, quote } from "./dom.js";
import { STAGES } from "./stages.js";
import { state } from "./state.js";

// Show an entity's name where the model passed its Qloo ID.
export const named = (input, labels = {}) => {
  const swap = (value) =>
    Array.isArray(value) ? value.map(swap) : typeof value === "string" ? (labels[value] ?? labels[value.toUpperCase()] ?? value) : value;
  return Object.fromEntries(Object.entries(input).map(([field, value]) => [field, swap(value)]));
};

// "urn:tag:genre:music:indian_indie" reads as "indian indie".
const tagName = (tag) => String(tag).split(":").pop().replace(/_/g, " ");

// Filters and place change what a call means, so they belong in its description.
const scope = (input) =>
  [
    list(input.include_tags).length && `tagged ${list(input.include_tags).map(tagName).join(" or ")}`,
    list(input.exclude_tags).length && `not ${list(input.exclude_tags).map(tagName).join(" or ")}`,
    input.signal_location && `audience in ${input.signal_location}`,
    input.filter_location && `located in ${input.filter_location}`,
    input.demographic && `for ${input.demographic}`,
  ]
    .filter(Boolean)
    .map((part) => `, ${part}`)
    .join("");

export const describeCall = (name, input) => {
  const signals = [...list(input.signals), ...list(input.signal_tags).map(tagName)].join(", ");
  switch (name) {
    case "qloo_describe":
      return `Look up ${input.entity}`;
    case "qloo_find_tags":
      return `Search Qloo tags for ${quote(input.query)}`;
    case "qloo_recommend":
      return `Find ${input.target_type}s this audience likes${signals ? `, from ${signals}` : ""}${scope(input)}`;
    case "qloo_rank":
      return `Rank ${list(input.options).length} candidates against the audience${signals ? ` of ${signals}` : ""}${scope(input)}`;
    case "qloo_where_popular":
      return `Find where ${input.entity} is popular in ${input.within}`;
    case "qloo_compare_audiences":
      return `Compare ${list(input.group_a).join(", ")} with ${list(input.group_b).join(", ")}`;
    case "qloo_entity_tags":
      return `Read the traits of ${list(input.entities).join(", ")}`;
    case "qloo_audience_demographics":
      return `Read the audience of ${input.entity}`;
    case "qloo_trends":
      return `Check the trend for ${list(input.entities).join(", ")}`;
    default:
      return name;
  }
};

const describeResult = (event) => {
  const count = event.result_count ?? 0;
  switch (event.status) {
    case "ok":
      return `${count} ${count === 1 ? "result" : "results"}`;
    case "empty":
      return "No match";
    case "needs_input":
      return "Needs a clearer input";
    case "partial":
      return `Partial, ${count} results`;
    case "degraded":
      return `Reduced quality, ${count} results`;
    default:
      return `Failed: ${event.error ?? "unknown error"}`;
  }
};

const formatRequest = ({ method, path, query }) => {
  const search = query && Object.keys(query).length ? `\n${JSON.stringify(query, null, 2)}` : "";
  return `${method} ${path}${search}`;
};

const scrollLog = () => {
  const log = $("#log-list");
  log.scrollTop = log.scrollHeight;
};

export const callCountText = () =>
  state.callCount ? `${state.callCount} Qloo ${state.callCount === 1 ? "call" : "calls"}` : "No Qloo calls yet";

const showCount = () => {
  $("#log-count").textContent = callCountText();
  $("#log-toggle").textContent = `${callCountText()}, ${$("#log").dataset.collapsed ? "show" : "hide"}`;
};

const row = (status, title, result, raw) =>
  el(
    "li",
    { class: "call", "data-status": status },
    el("details", {}, el("summary", {}, el("span", { class: "call-title", text: title }), result), raw),
  );

export const addCall = (event) => {
  const title = describeCall(event.name, named(event.input, event.labels));
  const result = el("span", { class: "call-result", text: event.name });
  const raw = el(
    "div",
    { class: "call-raw" },
    el("p", { text: `Sent to ${event.name}` }),
    el("pre", { text: JSON.stringify(event.input, null, 2) }),
  );
  const node = row("pending", title, result, raw);
  const entry = { kind: "call", title, result: event.name, status: "pending" };
  state.calls.set(event.id, { node, result, raw, entry, reused: event.reused });
  state.entries.push(entry);
  // A repeated identical call reuses the earlier result and costs no Qloo request.
  if (!event.reused) state.callCount += 1;
  $("#log-list").append(node);
  showCount();
  scrollLog();
};

export const finishCall = (event) => {
  const call = state.calls.get(event.id);
  if (!call) return;
  call.node.dataset.status = event.status;
  call.result.textContent = `${describeResult(event)} · ${call.reused ? "reused earlier result" : event.name}`;
  Object.assign(call.entry, { status: event.status, result: call.result.textContent });
  if (event.summary) call.raw.append(el("p", { text: "Qloo said" }), el("pre", { text: event.summary }));
  if (event.requests?.length) {
    call.raw.append(
      el("p", { text: "Qloo API requests" }),
      el("pre", { text: event.requests.map(formatRequest).join("\n\n") }),
    );
  }
  if (event.status === "error") state.lastError = event.error;
};

export const addNote = (raw) => {
  const text = plain(raw);
  state.notes.push(text);
  state.entries.push({ kind: "note", text });
  $("#log-list").append(el("li", { class: "note", text }));
  scrollLog();
  return text;
};

export const addStageHeading = (number) => {
  const text = `${number} · ${STAGES[number - 1].title}`;
  state.entries.push({ kind: "stage", text });
  $("#log-list").append(el("li", { class: "stage-head", text }));
};

export const resetLog = () => {
  $("#log-list").replaceChildren();
  showCount();
};

// Redraw a stored log. Raw request detail is not kept, so rows do not open.
export const showStoredLog = (entries) => {
  $("#log-list").replaceChildren(
    ...entries.map((entry) => {
      if (entry.kind === "note") return el("li", { class: "note", text: entry.text });
      if (entry.kind === "stage") return el("li", { class: "stage-head", text: entry.text });
      return el(
        "li",
        { class: "call stored", "data-status": entry.status },
        el(
          "div",
          { class: "call-summary" },
          el("span", { class: "call-title", text: entry.title }),
          el("span", { class: "call-result", text: entry.result }),
        ),
      );
    }),
  );
  showCount();
};

export const toggleLog = () => {
  const log = $("#log");
  if (log.dataset.collapsed) delete log.dataset.collapsed;
  else log.dataset.collapsed = "true";
  showCount();
};
