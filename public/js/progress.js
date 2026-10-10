// Progress while a scout runs: which stage it has reached, how long it has
// taken, and how many Qloo calls it has made.
import { $, el } from "./dom.js";
import { addStageHeading, callCountText } from "./log.js";
import { STAGES } from "./stages.js";

let reached = 0;
let startedAt = 0;
let timer;

const clock = () => {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const showMeta = () => {
  $("#working-meta").textContent = `${clock()} · ${callCountText()}`;
};

const drawStepper = () => {
  $("#stepper").replaceChildren(
    ...STAGES.map((stage, index) => {
      const number = index + 1;
      const status = number < reached ? "done" : number === reached ? "active" : "upcoming";
      return el(
        "li",
        { "data-status": status, "aria-current": status === "active" ? "step" : undefined },
        el("span", { class: "step-title", text: stage.title }),
      );
    }),
  );
};

export const resetProgress = () => {
  reached = 0;
  startedAt = Date.now();
  clearInterval(timer);
  timer = setInterval(showMeta, 1000);
  drawStepper();
  showMeta();
};

// Stages only move forward: a late tag lookup does not send the scout back.
export const advance = (number) => {
  if (number <= reached) return;
  reached = number;
  if (number <= STAGES.length) addStageHeading(number);
  drawStepper();
};

export const stopClock = () => clearInterval(timer);
