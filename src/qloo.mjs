// One shared connection to the local `qloo mcp` stdio server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { nameHeatmapCells } from "./places.mjs";

const INSTALL_HINT =
  "Cannot start `qloo`. Install it with: npm install --global @qloo/qloo-harness";

let connection;

const connect = async () => {
  const client = new Client({ name: "collab-scout", version: "0.1.0" });
  // The SDK forwards only a small default set of variables to the server.
  // Forward the full environment so QLOO_API_KEY and QLOO_HOME reach it.
  const transport = new StdioClientTransport({
    command: process.env.QLOO_COMMAND ?? "qloo",
    args: ["mcp"],
    env: process.env,
  });
  client.onclose = () => {
    connection = undefined;
  };
  await client.connect(transport).catch((error) => {
    throw error.code === "ENOENT" ? new Error(INSTALL_HINT) : error;
  });
  return client;
};

const qloo = () =>
  (connection ??= connect().catch((error) => {
    connection = undefined;
    throw error;
  }));

// qloo_capabilities is a readiness probe for us, not a tool for the model.
export const listQlooTools = async () => {
  const { tools } = await (await qloo()).listTools();
  return tools.filter((tool) => tool.name !== "qloo_capabilities");
};

export const qlooReady = async () => {
  const result = await (await qloo()).callTool({ name: "qloo_capabilities", arguments: {} });
  return Boolean(result.structuredContent?.adapter?.ready);
};

// Always resolves to a Qloo result envelope, so the agent can read failures too.
export const callQloo = async (name, args) => {
  try {
    const result = await (await qloo()).callTool({ name, arguments: args });
    const envelope = result.structuredContent;
    if (envelope?.status) {
      return name === "qloo_where_popular" ? nameHeatmapCells(envelope) : envelope;
    }
    return {
      status: "error",
      summary: result.content?.find((block) => block.type === "text")?.text ?? "No result.",
      error: { code: "UNKNOWN", retryable: false },
    };
  } catch (error) {
    return {
      status: "error",
      summary: error.message,
      error: { code: "TRANSPORT", retryable: true },
    };
  }
};

export const closeQloo = async () => {
  const pending = connection;
  connection = undefined;
  if (pending) await (await pending.catch(() => undefined))?.close();
};
