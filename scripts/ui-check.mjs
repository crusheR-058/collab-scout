// Click through a real scout in the installed Edge and save screenshots.
// Usage: node scripts/ui-check.mjs <base-url> <output-folder> ["who|names|want|goal|market"]
// Screenshots show Qloo results, so write them outside the repository.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const DEFAULT_FIELDS =
  "a specialty coffee roastery|Blue Bottle Coffee|musician|a limited-edition blend with an Indian independent act|India";
const [base = "http://localhost:8787", out = "ui-check", fields = DEFAULT_FIELDS] = process.argv.slice(2);
const [who, names, want, goal, market] = fields.split("|");
const SETTLED = "#panel-question:not([hidden]), #panel-brief:not([hidden]), #panel-ended:not([hidden])";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
const shot = (name, fullPage = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage });

// Answer questions until a brief or an end state arrives.
const settle = async (label) => {
  for (let asked = 0; ; asked += 1) {
    await page.waitForSelector(SETTLED, { timeout: 240000 });
    if (!(await page.isVisible("#panel-question"))) return;
    if (asked === 0) await shot(`${label}-question`, false);
    if (asked > 3) throw new Error("The scout kept asking questions.");
    const option = page.locator("#question-options button").first();
    if (await option.count()) await option.click();
    else {
      await page.fill("#question-answer", "Use your best judgment and continue.");
      await page.click("#panel-question button[type=submit]");
    }
    await page.waitForSelector("#panel-working:not([hidden])");
  }
};

await page.goto(base);
await page.waitForSelector("#status-qloo[data-state='ready']", { timeout: 20000 });
await page.fill("#f-who", who);
await page.selectOption("#f-want", want);
await page.fill("#f-goal", goal);
await page.fill("#f-names", names);
await page.fill("#f-market", market);
await shot("1-form");
await page.click("#brief-form button[type=submit]");

await page.waitForSelector("#log-list .call", { timeout: 60000 });
await shot("2-working", false);
await settle("3");

const gotBrief = await page.isVisible("#panel-brief");
await page.waitForTimeout(1500);
await shot(gotBrief ? "4-brief" : "4-ended");
console.log(
  gotBrief
    ? "brief delivered"
    : `ended: ${await page.textContent("#ended-title")} / ${await page.textContent("#ended-text")}`,
);

if (gotBrief) {
  const count = (selector) => page.locator(selector).count();
  console.log(
    `${await count(".partner")} partners, ${await count(".tag.match")} matched in Qloo, ` +
      `${await count(".tag.no-match")} not found, ${await count("img.partner-photo")} photos, ` +
      `${await count("#log-list .call")} log rows`,
  );

  // Ask for a change and wait for the revised brief.
  const before = await page.textContent(".pair-them");
  await page.fill("#refine-input", "Only partners with popularity under 0.85.");
  await page.click(".refine button[type=submit]");
  await page.waitForSelector("#panel-working:not([hidden])");
  await settle("5");
  await page.waitForTimeout(1500);
  await shot("5-revised");
  const after = (await page.isVisible("#panel-brief")) ? await page.textContent(".pair-them") : "no brief";
  console.log(`revised: top match ${before} -> ${after}`);

  // The scout should now be in history on the start page.
  await page.reload();
  await page.waitForSelector("#history-list li", { timeout: 10000 });
  await shot("6-start-with-history");
  await page.click(".history-open");
  await page.waitForSelector("#panel-brief:not([hidden])");
  await shot("7-reopened");
  console.log(`history: ${await count("#log-list li")} stored log rows, ${await count(".refine button")} start-again button`);

  await page.setViewportSize({ width: 390, height: 844 });
  await shot("8-phone-brief");
  await page.emulateMedia({ media: "print" });
  await shot("9-print");
}

console.log(problems.length ? problems.join("\n") : "no page errors");
await browser.close();
