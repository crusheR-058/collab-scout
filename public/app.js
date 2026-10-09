// Collab Scout front end: sends a brief, then renders the scout's event stream.
const $ = (selector) => document.querySelector(selector);

// Model output is untrusted, so every string goes in as text, never as HTML.
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("data-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter(Boolean));
  return node;
};

const EXAMPLES = [
  {
    label: "Coffee roaster × musician",
    brief:
      "I run a specialty coffee roastery, similar in feel to Blue Bottle Coffee. I want a musician to collaborate with on a limited-edition blend, ideally someone on the rise. My market is India.",
  },
  {
    label: "Lo-fi producer × clothing label",
    brief:
      "I'm a lo-fi hip hop producer in the vein of Nujabes and J Dilla. I want a clothing label to make a small merch capsule with.",
  },
  {
    label: "Bookshop × podcast",
    brief:
      "We're an independent bookshop known for literary fiction and translated novels. We want a podcast to co-host a monthly live recording in the shop.",
  },
];

const state = { sessionId: undefined, calls: new Map(), callCount: 0, notes: [], lastError: undefined };

/* ---------- Field log ---------- */

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const quote = (value) => `“${value}”`;

const describeCall = (name, input) => {
  const signals = [...list(input.signals), ...list(input.signal_tags)].join(", ");
  switch (name) {
    case "qloo_describe":
      return `Look up ${input.entity}`;
    case "qloo_find_tags":
      return `Search Qloo tags for ${quote(input.query)}`;
    case "qloo_recommend":
      return `Find ${input.target_type}s this audience likes${signals ? `, from ${signals}` : ""}`;
    case "qloo_rank":
      return `Rank ${list(input.options).length} candidates against the audience`;
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
      return "Needs your pick";
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

const addCall = (event) => {
  const result = el("span", { class: "call-result", text: event.name });
  const raw = el(
    "div",
    { class: "call-raw" },
    el("p", { text: `Sent to ${event.name}` }),
    el("pre", { text: JSON.stringify(event.input, null, 2) }),
  );
  const row = el(
    "li",
    { class: "call", "data-status": "pending" },
    el(
      "details",
      {},
      el("summary", {}, el("span", { class: "call-title", text: describeCall(event.name, event.input) }), result),
      raw,
    ),
  );
  state.calls.set(event.id, { row, result, raw });
  state.callCount += 1;
  $("#log-count").textContent = `${state.callCount} Qloo ${state.callCount === 1 ? "call" : "calls"}`;
  $("#log-list").append(row);
  scrollLog();
};

const finishCall = (event) => {
  const call = state.calls.get(event.id);
  if (!call) return;
  call.row.dataset.status = event.status;
  call.result.textContent = `${describeResult(event)} · ${event.name}`;
  if (event.summary) {
    call.raw.append(el("p", { text: "Qloo said" }), el("pre", { text: event.summary }));
  }
  if (event.requests?.length) {
    call.raw.append(
      el("p", { text: "Qloo API requests" }),
      el("pre", { text: event.requests.map(formatRequest).join("\n\n") }),
    );
  }
  if (event.status === "error") state.lastError = event.error;
};

// Models write Markdown; the log shows plain text, so drop the emphasis marks.
const plain = (text) => String(text ?? "").replace(/\*\*|__|`/g, "");

const addNote = (raw) => {
  const text = plain(raw);
  state.notes.push(text);
  $("#log-list").append(el("li", { class: "note", text }));
  $("#working-note").textContent = text.split("\n")[0];
  scrollLog();
};

/* ---------- Stage ---------- */

const PANELS = ["working", "question", "ended", "brief"];

const showPanel = (name) => {
  for (const panel of PANELS) $(`#panel-${panel}`).hidden = panel !== name;
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

const TRENDS = { rising: "↗ Rising", steady: "→ Steady", falling: "↘ Falling" };

const briefMarkdown = (brief) =>
  [
    `# ${brief.brand} × ${brief.partners[0]?.name ?? "no match"}`,
    brief.goal,
    `## Your audience\n${brief.audience_summary}`,
    `## Partners\n${brief.partners
      .map(
        (partner, index) =>
          `${index + 1}. **${partner.name}** (${partner.type})\n   ${partner.rationale}\n${list(partner.evidence)
            .map((item) => `   - ${item}`)
            .join("\n")}`,
      )
      .join("\n")}`,
    list(brief.locations).length &&
      `## Where\n${brief.locations.map((place) => `- **${place.name}**: ${place.rationale}`).join("\n")}`,
    `## Pitch\n${brief.pitch}`,
    `## What this does not show\n${list(brief.limitations)
      .map((item) => `- ${item}`)
      .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

const section = (title, ...children) => el("section", {}, el("h3", { text: title }), ...children);

const score = (partner) =>
  [
    typeof partner.affinity === "number" && `Affinity ${partner.affinity.toFixed(2)}`,
    typeof partner.popularity === "number" && `Popularity ${partner.popularity.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(" · ");

const renderPartner = (partner) =>
  el(
    "li",
    { class: "partner" },
    el(
      "div",
      {},
      el(
        "div",
        { class: "partner-head" },
        el("span", { class: "partner-name", text: partner.name }),
        el("span", { class: "tag", text: partner.type }),
        TRENDS[partner.trend] && el("span", { class: "tag", "data-trend": partner.trend, text: TRENDS[partner.trend] }),
      ),
      score(partner) && el("p", { class: "tag partner-score", text: score(partner) }),
      el("p", { class: "partner-why", text: partner.rationale }),
      list(partner.evidence).length && el("p", { class: "evidence-label", text: "From Qloo" }),
      el("ul", { class: "evidence" }, ...list(partner.evidence).map((item) => el("li", { text: item }))),
    ),
  );

const renderBrief = (brief) => {
  const partners = list(brief.partners);
  const copy = el("button", {
    class: "primary",
    type: "button",
    text: "Copy brief",
    onclick: async () => {
      await navigator.clipboard.writeText(briefMarkdown({ ...brief, partners }));
      copy.textContent = "Brief copied";
      setTimeout(() => (copy.textContent = "Copy brief"), 2000);
    },
  });

  $("#panel-brief").replaceChildren(
    el(
      "header",
      { class: "lockup" },
      el("p", { class: "eyebrow", text: partners.length ? "Top match" : "No match found" }),
      el(
        "h2",
        { class: "pair", "data-arrive": "", "aria-label": `${brief.brand} and ${partners[0]?.name ?? "no match"}` },
        el("span", { class: "pair-side pair-you", text: brief.brand }),
        el("span", { class: "pair-times", text: "×", ariaHidden: "true" }),
        el("span", { class: "pair-side pair-them", text: partners[0]?.name ?? "No one yet" }),
      ),
      el("p", { class: "brief-goal", text: brief.goal }),
    ),
    el(
      "div",
      { class: "brief-body" },
      section("Your audience", el("p", { text: brief.audience_summary })),
      partners.length && section("Partners, ranked", el("ol", { class: "partners" }, ...partners.map(renderPartner))),
      list(brief.locations).length &&
        section(
          "Where the overlap is strongest",
          el(
            "ul",
            { class: "places" },
            ...brief.locations.map((place) =>
              el("li", {}, el("strong", { text: place.name }), el("span", { text: place.rationale })),
            ),
          ),
        ),
      section("A pitch you can send", el("p", { class: "pitch", text: brief.pitch })),
      section(
        "What this does not show",
        el("ul", { class: "limits" }, ...list(brief.limitations).map((item) => el("li", { text: item }))),
      ),
    ),
    el(
      "footer",
      { class: "brief-actions" },
      copy,
      el("button", { class: "quiet", type: "button", text: "Start a new scout", onclick: restart }),
      el("p", { text: `Built from ${state.callCount} Qloo ${state.callCount === 1 ? "call" : "calls"} in the field log` }),
    ),
  );
  showPanel("brief");
  $("#panel-brief").scrollIntoView({ block: "start", behavior: "smooth" });
};

/* ---------- Event stream ---------- */

const handle = (event) => {
  if (event.type === "session") state.sessionId = event.id;
  if (event.type === "text") addNote(event.text);
  if (event.type === "tool_call") addCall(event);
  if (event.type === "tool_result") finishCall(event);
  if (event.type === "question") showQuestion(event);
  if (event.type === "brief") renderBrief(event.brief);
  if (event.type === "error") showEnded("The scout stopped early.", event.message);
  if (event.type === "done" && $("#panel-brief").hidden && $("#panel-ended").hidden) {
    const title =
      state.lastError === "QLOO_AUTH"
        ? "Qloo is not connected on this server."
        : "The scout finished without a brief.";
    showEnded(title, state.notes.at(-1) ?? "Try a brief with a well-known name the scout can look up.");
  }
};

async function* serverEvents(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error ?? `The server answered ${response.status}.`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const frames = buffer.split("\n\n");
    buffer = frames.pop();
    for (const frame of frames) {
      if (frame.startsWith("data: ")) yield JSON.parse(frame.slice(6));
    }
  }
}

const consume = async (events) => {
  try {
    for await (const event of events) handle(event);
  } catch (error) {
    const offline = error instanceof TypeError && /fetch|network/i.test(error.message);
    showEnded(offline ? "The scout could not reach the server." : "The scout hit a problem.", error.message);
  }
};

const startScout = (brief) => {
  Object.assign(state, { sessionId: undefined, callCount: 0, notes: [], lastError: undefined });
  state.calls.clear();
  $("#log-list").replaceChildren();
  $("#log-count").textContent = "No Qloo calls yet";
  $("#log-brief-text").textContent = brief;
  $("#working-note").textContent = "Reading your brief.";
  showPanel("working");

  document.body.dataset.view = "work";
  $("#view-idle").hidden = true;
  $("#view-steps").hidden = true;
  $("#view-work").hidden = false;
  window.scrollTo(0, 0);

  return consume(serverEvents("api/scout", { brief }));
};

function sendAnswer(answer) {
  showPanel("working");
  $("#working-note").textContent = `Continuing with ${quote(answer)}.`;
  return consume(serverEvents(`api/scout/${state.sessionId}/answer`, { answer }));
}

function restart() {
  document.body.dataset.view = "idle";
  $("#view-work").hidden = true;
  $("#view-idle").hidden = false;
  $("#view-steps").hidden = false;
  window.scrollTo(0, 0);
  $("#brief").focus();
}

/* ---------- Wiring ---------- */

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
          $("#brief").value = example.brief;
          $("#brief").focus();
        },
      }),
    ),
  ),
);

$("#brief-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const brief = $("#brief").value.trim();
  if (brief) startScout(brief);
});

$("#panel-question").addEventListener("submit", (event) => {
  event.preventDefault();
  const answer = $("#question-answer").value.trim();
  if (answer) sendAnswer(answer);
});

$("#restart").addEventListener("click", restart);
$("[data-restart]").addEventListener("click", restart);

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
    if (!qloo) {
      $("#form-hint").textContent = "Qloo is not connected, so a scout will stop at its first lookup.";
    }
  })
  .catch(() => setStatus("#status-qloo", "Server unreachable", "off"));
