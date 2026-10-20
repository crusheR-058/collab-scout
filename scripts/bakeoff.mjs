// Run the same briefs through the agent and print one line of measurements per
// run, to compare models and to check the evidence behind each brief. The model
// comes from BEDROCK_MODEL_ID. Spends Qloo quota and Bedrock tokens.
// Usage: node --env-file=.env scripts/bakeoff.mjs [runs-per-brief] [brief-name]
import { MODEL, answer, newSession, run } from "../src/agent.mjs";
import { closeQloo } from "../src/qloo.mjs";

const BRIEFS = {
  coffee:
    "I am a specialty coffee roastery. I want a musician or band to partner with for a limited-edition blend with an Indian independent act. My audience loves Blue Bottle Coffee. My market is India.",
  lofi: "I am a lo-fi hip hop producer. I want a brand to partner with for a small merch capsule with a clothing label. My audience loves Nujabes, J Dilla.",
  bookshop:
    "I am an independent bookshop known for literary fiction and translated novels. I want a podcast to partner with for a monthly live recording in the shop. My audience loves Elena Ferrante, Haruki Murakami, Sally Rooney. My market is London.",
  // Edge cases: no well-known names to anchor an audience, and a request Qloo's
  // consumer taste data does not cover.
  unanchored: "I run a small family bakery called Rosie's Crumbs in Leeds. I want a local partner for a summer event.",
  offdomain: "We sell B2B invoicing software. Find us an accounting firm to partner with for referrals.",
};
const RUNS = Number(process.argv[2] ?? 2);
const ONLY = process.argv[3];
const MAX_QUESTIONS = 3;
const NON_LATIN = /[぀-ヿ㐀-鿿가-힯]/;

const scout = async (name, text) => {
  const session = newSession(text);
  const started = Date.now();
  const result = { model: MODEL, brief: name, outcome: "no brief", calls: 0, questions: 0, toolProblems: 0 };

  for (;;) {
    let question;
    for await (const event of run(session)) {
      if (event.type === "tool_call") result.calls += 1;
      if (event.type === "tool_result" && event.status !== "ok") result.toolProblems += 1;
      if (event.type === "question") question = event;
      if (event.type === "error") result.outcome = `error: ${event.message.slice(0, 90)}`;
      if (event.type === "brief") {
        const { partners, pitch, limitations, locations, opportunities: scan, affinity_basis: basis } = event.brief;
        const top = partners[0].name.split(/\s+/)[0];
        Object.assign(result, {
          outcome: "brief",
          partners: partners.length,
          matched: partners.filter((partner) => partner.verified).length,
          // Names or places in the brief that Qloo never returned in this scout.
          unsupported: partners.filter((partner) => !partner.verified).length + locations.filter((place) => !place.qloo).length,
          sharedAffinity: basis ? `${basis.covers}/${partners.length} via ${basis.tool}` : "none",
          trends: partners.filter((partner) => partner.trend).length,
          scan: scan ? `${scan.candidates.length} candidates, ${scan.categories.length} categories` : "none",
          profile: scan?.profile ? `${scan.profile.tags.items.length} tags, ${Object.keys(scan.profile.demographics.age).length} age bands` : "none",
          top: partners[0].name,
          pitchToTop: pitch.includes(top),
          strayScript: NON_LATIN.test(JSON.stringify(event.brief)),
          limitations: limitations.length,
          firstLimitation: limitations[0]?.slice(0, 160),
        });
      }
    }
    if (result.outcome !== "no brief" || !question || result.questions >= MAX_QUESTIONS) break;
    result.questions += 1;
    answer(session, "Use your best judgment and continue.");
  }

  result.sentBack = [session.askedForMore && "thin", session.askedForScan && "scan"].filter(Boolean).join(",") || "no";
  Object.assign(result, session.usage);
  result.seconds = Math.round((Date.now() - started) / 1000);
  return result;
};

for (let round = 0; round < RUNS; round += 1) {
  for (const [name, text] of Object.entries(BRIEFS).filter(([name]) => !ONLY || name === ONLY)) {
    const result = await scout(name, text).catch((error) => ({ model: MODEL, brief: name, outcome: `crash: ${error.message}` }));
    console.log(JSON.stringify(result));
  }
}
await closeQloo();
