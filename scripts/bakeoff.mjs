// Run the same briefs through the agent and print one line of measurements per
// run, to compare models. The model comes from BEDROCK_MODEL_ID.
// Usage: node --env-file=.env scripts/bakeoff.mjs [runs-per-brief]
import { MODEL, answer, newSession, run } from "../src/agent.mjs";
import { closeQloo } from "../src/qloo.mjs";

const BRIEFS = {
  coffee:
    "I am a specialty coffee roastery. I want a musician or band to partner with for a limited-edition blend with an Indian independent act. My audience loves Blue Bottle Coffee. My market is India.",
  lofi: "I am a lo-fi hip hop producer. I want a brand to partner with for a small merch capsule with a clothing label. My audience loves Nujabes, J Dilla.",
  bookshop:
    "I am an independent bookshop known for literary fiction and translated novels. I want a podcast to partner with for a monthly live recording in the shop. My audience loves Elena Ferrante, Haruki Murakami, Sally Rooney. My market is London.",
};
const RUNS = Number(process.argv[2] ?? 2);
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
        const { partners, pitch, limitations } = event.brief;
        const top = partners[0].name.split(/\s+/)[0];
        Object.assign(result, {
          outcome: "brief",
          partners: partners.length,
          matched: partners.filter((partner) => partner.verified).length,
          top: partners[0].name,
          pitchToTop: pitch.includes(top),
          strayScript: NON_LATIN.test(JSON.stringify(event.brief)),
          limitations: limitations.length,
        });
      }
    }
    if (result.outcome !== "no brief" || !question || result.questions >= MAX_QUESTIONS) break;
    result.questions += 1;
    answer(session, "Use your best judgment and continue.");
  }

  result.sentBack = Boolean(session.askedForMore);
  result.seconds = Math.round((Date.now() - started) / 1000);
  return result;
};

for (let round = 0; round < RUNS; round += 1) {
  for (const [name, text] of Object.entries(BRIEFS)) {
    const result = await scout(name, text).catch((error) => ({ model: MODEL, brief: name, outcome: `crash: ${error.message}` }));
    console.log(JSON.stringify(result));
  }
}
await closeQloo();
