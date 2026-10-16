// Temporary: record every Bedrock request of one coffee scout, for measuring token use.
import { writeFileSync } from "node:fs";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { answer, newSession, run } from "./src/agent.mjs";
import { closeQloo } from "./src/qloo.mjs";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "ap-south-1" });
const steps = [];
const converse = async (input, abortSignal) => {
  const response = await client.send(new ConverseCommand(input), { abortSignal });
  steps.push({ messages: structuredClone(input.messages), inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens });
  return response;
};

const session = newSession(
  "I am a specialty coffee roastery. I want a musician or band to partner with for a limited-edition blend with an Indian independent act. My audience loves Blue Bottle Coffee. My market is India.",
);
let outcome = "no brief";
for (let questions = 0; ; questions += 1) {
  let question;
  for await (const event of run(session, { converse })) {
    if (event.type === "question") question = event;
    if (event.type === "brief") outcome = `brief, ${event.brief.partners.length} partners`;
    if (event.type === "error") outcome = `error: ${event.message}`;
  }
  if (outcome !== "no brief" || !question || questions >= 3) break;
  answer(session, "Use your best judgment and continue.");
}
writeFileSync(process.argv[2], JSON.stringify(steps));
console.log(JSON.stringify({ outcome, steps: steps.length, ...session.usage }));
await closeQloo();
