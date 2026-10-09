// Run one scout in the terminal.
// Usage: npm run scout -- "a specialty coffee roaster in Pune looking for a co-branded drop"
import { createInterface } from "node:readline/promises";
import { answer, newSession, run } from "../src/agent.mjs";
import { closeQloo } from "../src/qloo.mjs";

const brief = process.argv.slice(2).join(" ").trim();
if (!brief) {
  console.error('Usage: npm run scout -- "<who you are and what partner you want>"');
  process.exit(1);
}

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const session = newSession(brief);

const print = (event) => {
  if (event.type === "text") console.log(`\n${event.text}`);
  if (event.type === "tool_call") console.log(`→ ${event.name} ${JSON.stringify(event.input)}`);
  if (event.type === "tool_result") {
    const count = event.result_count === undefined ? "" : `, ${event.result_count} results`;
    console.log(`← ${event.name}: ${event.status}${count} — ${event.error ?? event.summary ?? ""}`);
  }
  if (event.type === "brief") console.log(`\nBRIEF\n${JSON.stringify(event.brief, null, 2)}`);
  if (event.type === "error") console.error(`\nError: ${event.message}`);
};

try {
  while (!session.done) {
    let question;
    let failed = false;
    for await (const event of run(session)) {
      print(event);
      if (event.type === "question") question = event;
      if (event.type === "error") failed = true;
    }
    if (!question) {
      if (failed) process.exitCode = 1;
      break;
    }
    console.log(`\n? ${question.question}`);
    question.options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
    // Input ends early when answers are piped in; stop instead of crashing.
    const reply = (await terminal.question("> ").catch(() => "")).trim();
    if (!reply) break;
    answer(session, question.options[Number(reply) - 1] ?? reply);
  }
} finally {
  terminal.close();
  await closeQloo();
}
