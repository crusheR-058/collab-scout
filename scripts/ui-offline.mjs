// Render a brief in the installed Edge without Qloo or Bedrock: a synthetic
// scout, built by the real grounding and scoring code from made-up fixtures,
// is saved in a scratch database and opened from history. Nothing here is Qloo data.
// Usage: node scripts/ui-offline.mjs <output-folder>
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { checkBrief, checkPlan, groundBrief, groundPlan, profileFrom, recordEntities, recordPlaces } from "../src/brief.mjs";
import { scoreScan } from "../public/js/opportunities.js";
import { openDatabase } from "../src/db.mjs";
import { brief, entity, ok, plan } from "../test/fixtures.mjs";

const out = process.argv[2] ?? "ui-offline";
mkdirSync(out, { recursive: true });

// Fixture IDs only need to be unique within this scout.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const seed = entity("Sample Seed Brand", id(99), { subtype: undefined });
const candidate = (name, n, category, popularity, affinity) =>
  entity(name, id(n), {
    subtype: `urn:entity:${category}`,
    popularity,
    affinity,
    properties: { description: `A made-up ${category} used to test the page.` },
  });
const artists = [1, 2, 3, 4, 5].map((n) => candidate(`Sample Artist ${n}`, n, "artist", 0.5 + n / 12, 0.95 - n / 20));
const podcasts = [1, 2, 3].map((n) => candidate(`Sample Podcast ${n}`, 10 + n, "podcast", 0.6 + n / 10, 0.9 - n / 20));

const entities = new Map();
recordEntities(entities, "qloo_describe", ok([seed], { interpretation: { entity: { type: "urn:entity:brand" } } }), { id: "d1", input: { entity: "Sample Seed Brand" } });
const scanCalls = [
  { category: "artist", envelope: ok(artists) },
  { category: "podcast", envelope: ok(podcasts) },
];
for (const { category, envelope } of scanCalls) {
  recordEntities(entities, "qloo_recommend", envelope, { id: `s-${category}`, input: { target_type: category, signals: [seed.entity_id] }, labels: { [seed.entity_id]: seed.name } });
}
recordEntities(entities, "qloo_rank", ok(artists.slice(0, 4).map((artist, n) => ({ ...artist, affinity: 0.9 - n / 10 }))), {
  id: "r1",
  input: { option_type: "artist", options: artists.slice(0, 4).map((artist) => artist.name), signals: [seed.entity_id] },
  labels: { [seed.entity_id]: seed.name },
});
recordEntities(entities, "qloo_trends", {
  status: "ok",
  series: [{ entity: { name: "Sample Artist 1" }, points: [{ date: "2026-10-01", population_rank: "900" }, { date: "2026-07-01", population_rank: "1200" }] }],
});
const places = new Map();
recordPlaces(places, { interpretation: { entity: { name: "Sample Artist 1" } }, results: [{ query: { affinity: 0.9 }, nearest_city: { name: "Pune", country: "IN", distance_km: 4 } }] });

const draft = {
  ...brief(["Sample Artist 1", "Sample Artist 2", "Sample Artist 3", "Sample Artist 5", "Not In Qloo"]),
  locations: [
    { name: "Pune", rationale: "Strongest heatmap cell." },
    { name: "Atlantis", rationale: "Not from any heatmap." },
  ],
};
const delivered = {
  ...groundBrief(checkBrief(draft).brief, entities, places),
  opportunities: {
    ...scoreScan({ calls: scanCalls, seeds: [entities.get("sampleseedbrand")], prefer: "emerging" }),
    profile: profileFrom(
      ok([
        { name: "indie", type: "urn:tag:genre:music", affinity: 1 },
        { name: "Coffee shop", type: "urn:tag:genre:place", affinity: 1 },
        { name: "cooking", type: "urn:tag:genre:media", affinity: 0.99 },
      ]),
      ok([{ query: { age: { "24_and_younger": -0.04, "25_to_29": -0.28, "30_to_34": 0.3, "55_and_older": 0.01 }, gender: { male: 0.16, female: -0.16 } } }], {
        interpretation: { entity: { name: "Sample Seed Brand" } },
      }),
    ),
    at: new Date().toISOString(),
  },
};
const plans = ["Sample Artist 1", "Sample Artist 2"].map((partner, n) =>
  groundPlan(checkPlan({ ...plan(partner), ...(n === 0 && { outreach_message: "Hi, we are a small roastery whose audience overlaps yours in Qloo. A sample first message." }) }).plan, entities),
);

// Saved the way the server saves a scout: a signed-in owner, the research,
// its versions and its field log. The browser gets that owner's session cookie.
const token = randomBytes(32).toString("base64url");
const ownerId = "offline-check-owner";
const researchId = randomUUID();
const databasePath = join(mkdtempSync(join(tmpdir(), "collab-scout-ui-")), "ui.db");
const db = openDatabase(databasePath);
db.touchOwner(ownerId, "offline-check@example.com");
db.createSession(createHash("sha256").update(token).digest("hex"), ownerId, new Date(Date.now() + 3600_000).toISOString());
db.createResearch({ id: researchId, ownerId, briefText: "A synthetic brief for the offline UI check.", model: "offline" });
db.addEvent(researchId, "tool_call", { type: "tool_call", id: "c1", name: "qloo_describe", input: { entity: "Sample Seed Brand" } });
db.addEvent(researchId, "tool_result", { type: "tool_result", id: "c1", name: "qloo_describe", status: "ok", result_count: 1, requests: [{ method: "GET", path: "/search" }] });
db.addVersion(researchId, "brief", delivered);
for (const saved of [...plans].reverse()) db.addVersion(researchId, "plan", saved);
db.setStatus(researchId, "delivered");
db.close();

// The server, without Qloo: only static files and saved research are needed.
const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, [fileURLToPath(new URL("../src/server.mjs", import.meta.url))], {
  env: { ...process.env, PORT: String(port), QLOO_COMMAND: "qloo-not-installed-for-tests", DATABASE_PATH: databasePath },
  stdio: ["ignore", "pipe", "ignore"],
});
await new Promise((resolve) => server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve()));

const browser = await chromium.launch({ channel: "msedge" });
const problems = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "cs_session", value: token, url: `http://127.0.0.1:${port}` }]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => message.type() === "error" && problems.push(`console: ${message.text()}`));
  await page.goto(`http://127.0.0.1:${port}/scout`);
  console.log(`signed in as ${await page.textContent("#account-email")}`);
  await page.click(".history-open");
  await page.waitForSelector("#panel-brief:not([hidden])");
  const count = (selector) => page.locator(selector).count();

  // Wide content must scroll inside its own box. A panel clips what overflows
  // it, so look for elements that reach past the screen edge, not page width.
  const checkPhone = async (name) => {
    // Values that leaked into the page as text instead of being left out.
    const leaked = await page.evaluate(() => document.querySelector("#panel-brief").innerText.match(/\b(false|undefined|NaN|null|\[object \w+\])\b/g));
    if (leaked) problems.push(`${name}: stray text ${[...new Set(leaked)].join(", ")}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${out}/${name}-phone.png`, fullPage: true });
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((node) => node.getClientRects().length && !node.closest(".table-wrap"))
        .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
        .map((node) => node.getAttribute("class") || node.tagName.toLowerCase())
        .slice(0, 5),
    );
    if (clipped.length) problems.push(`${name} on a phone: content runs past the screen edge (${clipped.join(", ")})`);
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  const open = async (tab) => {
    await page.click(`#tab-${tab}`);
    await page.waitForSelector(`#tabpanel-${tab}:not([hidden])`);
  };

  console.log(
    `brief: ${await count(".partner")} partners, ${await count(".tag.match")} matched, ${await count(".tag.no-match")} not found, ` +
      `${await count(".meter-row")} bars, ${await count("[data-trend]")} trends, ${await count(".records")} record sets, ` +
      `${await count(".place-check.unchecked")} unchecked locations, ${await count("[role=tab]")} tabs, ${await count("#log-list .call[data-status=ok]")} log rows replayed from the database`,
  );
  await page.click(".records summary");
  await page.screenshot({ path: `${out}/brief.png`, fullPage: true });
  await checkPhone("brief");

  // Without Qloo the check reaches the server and comes back as a message, not a crash.
  await page.click(".check-button");
  await page.waitForFunction(() => !document.querySelector(".check-button").disabled);
  console.log(`check for changes: ${(await page.locator(".check-button + [role=status]").innerText()).replace(/\s+/g, " ").slice(0, 160)}`);

  // Share, then open the link signed out.
  await page.click("button >> text=Create a share link");
  const shareUrl = await page.inputValue(".share-url");
  console.log(`share link: ${shareUrl.replace(/[\w-]{32}$/, "<token>")}`);
  const stranger = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const shared = await stranger.newPage();
  shared.on("pageerror", (error) => problems.push(`shared page error: ${error.message}`));
  await shared.goto(shareUrl);
  await shared.waitForSelector("#panel-brief:not([hidden])");
  console.log(
    `shared page: ${await shared.locator(".partner").count()} partners, ${await shared.locator("[role=tab]").count()} tabs, ` +
      `app actions shown: ${await shared.locator(".refine, .share, .check-button, .compare-form, button >> text=Start a new scout").count()}`,
  );
  await shared.screenshot({ path: `${out}/shared.png`, fullPage: true });
  await page.click("button >> text=Stop sharing");
  await shared.reload();
  await shared.waitForSelector("#share-missing:not([hidden])");
  console.log(`after stop sharing: ${await shared.textContent("#share-missing-text")}`);
  await stranger.close();

  await open("dna");
  console.log(`dna: ${await count(".tag-group")} tag groups, ${await count(".skew")} skew bars, ${await count(".dna .limits li")} gaps`);
  await page.screenshot({ path: `${out}/dna.png`, fullPage: true });
  await checkPhone("dna");

  await open("opportunities");
  const rows = () => count("#tabpanel-opportunities .opportunities tbody tr");
  console.log(`opportunities: ${await count("#tabpanel-opportunities .radar-chart .dot")} dots (${await count(".radar-chart .dot[data-chosen]")} partners), ${await rows()} rows`);
  await page.click("#tabpanel-opportunities .chips .chip >> nth=1");
  console.log(`  after hiding one category: ${await count("#tabpanel-opportunities .radar-chart .dot")} dots, ${await rows()} rows`);
  await page.click("#tabpanel-opportunities .chips .chip >> nth=1");
  await page.click("#tabpanel-opportunities .segmented button >> text=Established");
  console.log(`  ranked for established: top is ${await page.textContent("#tabpanel-opportunities .opportunities tbody tr th button")}, moved column: ${await count("th >> text=Moved")}`);
  await page.locator(".radar-chart .hit").first().hover();
  console.log(`  tooltip: ${(await page.textContent(".radar-tip")).replace(/\s+/g, " ")}`);
  await page.click("#tabpanel-opportunities .opportunities tbody tr th button");
  console.log(`  selected: ${(await page.textContent(".radar-detail .facts")).replace(/\s+/g, " ").slice(0, 160)}`);
  // Keyboard: arrow keys move between tabs.
  await page.focus("#tab-opportunities");
  await page.keyboard.press("ArrowRight");
  console.log(`  ArrowRight moves to: ${await page.evaluate(() => document.activeElement.id)}`);
  await open("opportunities");
  await page.fill("#compare-market", "Delhi");
  await page.click(".compare-form button[type=submit]");
  await page.waitForFunction(() => !document.querySelector(".compare-form button[type=submit]").disabled);
  console.log(`compare without Qloo: ${(await page.locator(".compare-form + [role=status]").innerText()).replace(/\s+/g, " ").slice(0, 200)}`);
  await page.screenshot({ path: `${out}/opportunities.png`, fullPage: true });
  await checkPhone("opportunities");

  await open("plans");
  console.log(`plans: ${await count("#tabpanel-plans .segmented button")} plan switches, compare rows ${await count(".compare tbody tr")}, sections ${await count(".plan section")}`);
  await page.click(".plans .segmented button >> nth=1");
  console.log(`  opened: ${await page.textContent(".plan-head h3")}`);
  await page.click(".plans .segmented button >> nth=0");
  console.log(`  first message shown for ${await page.textContent(".plan-head h3")}: ${await page.locator(".plan h3 >> text=A first message to send").count()}`);
  await page.screenshot({ path: `${out}/plans.png`, fullPage: true });
  await checkPhone("plans");

  await page.emulateMedia({ media: "print" });
  console.log(`print shows ${await page.locator(".tabpanel").evaluateAll((panels) => panels.filter((panel) => getComputedStyle(panel).display !== "none").length)} of ${await count(".tabpanel")} tab panels`);
  console.log(problems.length ? problems.join("\n") : "no page errors");
} finally {
  await browser.close();
  server.kill();
}
