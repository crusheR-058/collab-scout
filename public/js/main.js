// Collab Scout front end: sends a brief, then renders the scout's event stream.
import { renderBrief } from "./brief.js";
import { $, el, list, plain, quote } from "./dom.js";
import { focusForm, prefill, setupForm } from "./form.js";
import { saveScout, showHistory } from "./history.js";
import { addCall, addNote, finishCall, resetLog, showStoredLog, toggleLog } from "./log.js";
import { advance, resetProgress, showMeta, stopClock } from "./progress.js";
import { BRIEF_STAGE, STAGES, stageOf } from "./stages.js";
import { resetState, state } from "./state.js";
import { serverEvents } from "./stream.js";

let controller;

/* ---------- Views and panels ---------- */

const PANELS = ["working", "question", "ended", "brief"];

const showPanel = (name) => {
  for (const panel of PANELS) $(`#panel-${panel}`).hidden = panel !== name;
  if (name !== "working") stopClock();
};

const showView = (view) => {
  document.body.dataset.view = view;
  $("#view-idle").hidden = view !== "idle";
  $("#view-steps").hidden = view !== "idle";
  $("#view-work").hidden = view !== "work";
  showHistory(openScout);
  window.scrollTo(0, 0);
};

const showWorking = (note) => {
  $("#working-note").textContent = note;
  showPanel("working");
  resetProgress();
};

const showQuestion = (event) => {
  const options = list(event.options).filter((option) => typeof option === "string");
  const question = plain(event.question);
  $("#question-text").textContent = question;
  $("#question-text").classList.toggle("long", question.length > 140);
  $("#question-options").replaceChildren(
    ...options.map((option) =>
      el("button", { class: "option", type: "button", text: option, onclick: () => sendAnswer(option) }),
    ),
  );
  $("#question-answer").value = "";
  showPanel("question");
  (options.length ? $("#question-options button") : $("#question-answer")).focus();
};

const showEnded = (title, text) => {
  $("#ended-title").textContent = title;
  $("#ended-text").textContent = text;
  showPanel("ended");
};

const showBrief = () => {
  renderBrief(state.brief, {
    onRefine: state.live ? refine : undefined,
    onRestart: restart,
    onStartAgain: () => {
      restart();
      prefill(state.briefText);
    },
  });
  showPanel("brief");
  $("#panel-brief").scrollIntoView({ block: "start", behavior: "smooth" });
};

/* ---------- Event stream ---------- */

const handle = (event) => {
  if (event.type === "session") state.sessionId = event.id;
  if (event.type === "text") $("#working-note").textContent = addNote(event.text).split("\n")[0];
  if (event.type === "tool_call") {
    advance(stageOf(event.name));
    addCall(event);
    showMeta();
  }
  if (event.type === "tool_result") finishCall(event);
  if (event.type === "question") showQuestion(event);
  if (event.type === "brief") {
    advance(BRIEF_STAGE);
    state.brief = event.brief;
    saveScout({
      id: state.sessionId,
      at: Date.now(),
      text: state.briefText,
      brief: state.brief,
      entries: state.entries,
      callCount: state.callCount,
    });
    showBrief();
  }
  if (event.type === "error") showEnded("The scout stopped early.", event.message);
  if (event.type === "done" && $("#panel-brief").hidden && $("#panel-ended").hidden) {
    const title =
      state.lastError === "QLOO_AUTH" ? "Qloo is not connected on this server." : "The scout finished without a brief.";
    showEnded(title, state.notes.at(-1) ?? "Try a brief with a well-known name the scout can look up.");
  }
};

const failed = (error) => {
  if (error.name === "AbortError") {
    showEnded("Scout stopped.", "No more Qloo calls will be made for this scout.");
    return;
  }
  const offline = error instanceof TypeError && /fetch|network/i.test(error.message);
  showEnded(offline ? "The scout could not reach the server." : "The scout hit a problem.", error.message);
};

const consume = async (url, body, onError = failed) => {
  controller = new AbortController();
  try {
    for await (const event of serverEvents(url, body, controller.signal)) handle(event);
  } catch (error) {
    onError(error);
  }
};

// On a phone the log starts folded away, under the stage.
const foldLogOnPhone = () => {
  if (matchMedia("(max-width: 860px)").matches) $("#log").dataset.collapsed = "true";
  else delete $("#log").dataset.collapsed;
};

const startScout = (text) => {
  resetState(text);
  resetLog();
  $("#log-brief-text").textContent = text;
  foldLogOnPhone();
  showView("work");
  showWorking("Reading your brief.");
  return consume("api/scout", { brief: text });
};

function sendAnswer(answer) {
  showWorking(`Continuing with ${quote(answer)}.`);
  return consume(`api/scout/${state.sessionId}/answer`, { answer });
}

// A change to a delivered brief. If it cannot start, keep the brief on screen.
function refine(change) {
  addNote(`Change requested: ${change}`);
  showWorking(`Revising: ${change}`);
  return consume(`api/scout/${state.sessionId}/answer`, { answer: change }, (error) => {
    if (error.name === "AbortError") return failed(error);
    showBrief();
    $("#refine-hint").textContent = error.message;
  });
}

function restart() {
  showView("idle");
  focusForm();
}

// Reopen a scout saved in this browser.
function openScout(scout) {
  Object.assign(state, {
    sessionId: scout.id,
    live: false,
    briefText: scout.text,
    brief: scout.brief,
    entries: scout.entries,
    callCount: scout.callCount,
    notes: [],
  });
  state.calls.clear();
  $("#log-brief-text").textContent = scout.text;
  foldLogOnPhone();
  showView("work");
  showStoredLog(scout.entries);
  showBrief();
}

/* ---------- Wiring ---------- */

$("#steps-list").append(
  ...STAGES.map((stage) =>
    el(
      "li",
      {},
      el("h3", { text: stage.title }),
      el("p", { text: stage.text }),
      stage.tools.length && el("p", { class: "tools" }, ...stage.tools.slice(0, 2).map((tool) => el("code", { text: tool }))),
    ),
  ),
);

setupForm(startScout);

$("#panel-question").addEventListener("submit", (event) => {
  event.preventDefault();
  const answer = $("#question-answer").value.trim();
  if (answer) sendAnswer(answer);
});

$("#stop").addEventListener("click", () => controller?.abort());
$("#log-toggle").addEventListener("click", toggleLog);
$("#restart").addEventListener("click", restart);
$("[data-restart]").addEventListener("click", restart);

showHistory(openScout);

const setStatus = (id, text, stateName) => {
  const pill = $(id);
  pill.textContent = text;
  pill.hidden = false;
  if (stateName) pill.dataset.state = stateName;
};

fetch("api/health")
  .then((response) => response.json())
  .then(({ qloo, model }) => {
    setStatus("#status-qloo", qloo ? "Qloo: connected" : "Qloo: not connected", qloo ? "ready" : "off");
    setStatus("#status-model", `Model: ${model}`);
    if (!qloo) $("#form-hint").textContent = "Qloo is not connected, so a scout will stop at its first lookup.";
  })
  .catch(() => setStatus("#status-qloo", "Server unreachable", "off"));
