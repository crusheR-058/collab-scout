// Saved scouts, stored on the server for this browser only. The server knows
// this browser by a private cookie; nothing here is shared with other people.
import { $, el } from "./dom.js";

const STATUS = {
  delivered: "",
  needs_input: "waiting for your answer",
  running: "running",
  failed: "stopped early",
  cancelled: "stopped",
  expired: "expired",
  interrupted: "interrupted",
};

const date = (time) => new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// History is a convenience: if the server cannot be reached, the page still works.
const request = async (url, options) => {
  const response = await fetch(url, options);
  if (response.status === 401) location.assign("/signin");
  if (!response.ok && response.status !== 204) throw new Error((await response.json().catch(() => ({}))).error ?? `The server answered ${response.status}.`);
  return response.status === 204 ? undefined : response.json();
};

export const loadScout = (id) => request(`api/research/${encodeURIComponent(id)}`);

export const showHistory = async (onOpen) => {
  const { research } = await request("api/research").catch(() => ({ research: [] }));
  $("#view-history").hidden = research.length === 0 || document.body.dataset.view !== "idle";
  $("#history-list").replaceChildren(
    ...research.map((scout) =>
      el(
        "li",
        {},
        el(
          "button",
          { class: "history-open", type: "button", onclick: () => onOpen(scout.id) },
          el("span", { class: "history-title", text: scout.title ?? scout.brief_text.slice(0, 80) }),
          el("span", {
            class: "history-meta",
            text: [date(scout.updated_at), `${scout.qloo_calls} Qloo calls`, STATUS[scout.status]].filter(Boolean).join(" · "),
          }),
        ),
        el("button", {
          class: "quiet",
          type: "button",
          text: "Delete",
          "aria-label": `Delete the scout from ${date(scout.updated_at)}`,
          onclick: async () => {
            await request(`api/research/${encodeURIComponent(scout.id)}`, { method: "DELETE" }).catch(() => {});
            showHistory(onOpen);
          },
        }),
      ),
    ),
  );
};

export const forgetBrowser = () => request("api/me", { method: "DELETE" });
