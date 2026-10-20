// A shared brief: the app's brief view without its actions, for anyone with the link.
import { renderBrief } from "./brief.js";
import { $ } from "./dom.js";

const missing = (text) => {
  $("#share-missing-text").textContent = text;
  $("#share-missing").hidden = false;
};

const token = location.pathname.split("/").pop();
try {
  const response = await fetch(`/api/shared/${encodeURIComponent(token)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) missing(body.error ?? `The server answered ${response.status}.`);
  else {
    renderBrief(body.brief, { plans: body.plans });
    document.title = `${body.brief.brand} × ${body.brief.partners[0]?.name ?? "no match"} · Collab Scout`;
    $("#panel-brief").hidden = false;
  }
} catch {
  missing("The brief could not be loaded. Check your connection and try again.");
}
