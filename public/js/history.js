// Finished scouts, kept in this browser only. Storage can be missing or blocked
// (private windows, cleared site data), so every access is guarded and the page
// works without it.
import { $, el } from "./dom.js";

const KEY = "collab-scout:scouts";
const LIMIT = 20;

const read = () => {
  try {
    const scouts = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(scouts) ? scouts : [];
  } catch {
    return [];
  }
};

const write = (scouts) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(scouts.slice(0, LIMIT)));
  } catch {
    // Storage is unavailable or full: history is a convenience, so carry on.
  }
};

// A revised brief replaces the earlier version of the same scout.
export const saveScout = (scout) => write([scout, ...read().filter((saved) => saved.id !== scout.id)]);

const date = (time) => new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export const showHistory = (onOpen) => {
  const scouts = read();
  $("#view-history").hidden = scouts.length === 0 || document.body.dataset.view !== "idle";
  $("#history-list").replaceChildren(
    ...scouts.map((scout) =>
      el(
        "li",
        {},
        el(
          "button",
          { class: "history-open", type: "button", onclick: () => onOpen(scout) },
          el("span", { class: "history-title", text: `${scout.brief.brand} × ${scout.brief.partners[0]?.name ?? "no match"}` }),
          el("span", { class: "history-meta", text: `${date(scout.at)} · ${scout.callCount} Qloo calls` }),
        ),
        el("button", {
          class: "quiet",
          type: "button",
          text: "Delete",
          "aria-label": `Delete the scout from ${date(scout.at)}`,
          onclick: () => {
            write(read().filter((saved) => saved.id !== scout.id));
            showHistory(onOpen);
          },
        }),
      ),
    ),
  );
};
