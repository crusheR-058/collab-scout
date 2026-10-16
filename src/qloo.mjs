// One shared connection to the local `qloo mcp` stdio server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { setTimeout as sleep } from "node:timers/promises";
import { log } from "./log.mjs";
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
// `signal` stops an in-flight call when the visitor stops the scout; the MCP
// client's own 60 s timeout bounds a call that hangs.
const callOnce = async (name, args, signal) => {
  try {
    const result = await (await qloo()).callTool({ name, arguments: args }, undefined, { signal });
    const envelope = result.structuredContent;
    if (envelope?.status) {
      return name === "qloo_where_popular" ? nameHeatmapCells(envelope) : envelope;
    }
    return {
      status: "error",
      summary: result.content?.find((block) => block.type === "text")?.text ?? "No result.",
      error: { code: "INVALID_RESPONSE", retryable: false },
    };
  } catch (error) {
    return { status: "error", summary: error.message, error: failure(error) };
  }
};

// The harness classifies Qloo's own failures (QLOO_AUTH, QLOO_RATE_LIMIT,
// QLOO_TIMEOUT, QLOO_UPSTREAM and so on); these are failures before Qloo answers.
const failure = (error) => {
  if (error.name === "AbortError" || /abort/i.test(error.message)) return { code: "CANCELLED", retryable: false };
  if (/timed out/i.test(error.message)) return { code: "QLOO_TIMEOUT", retryable: true };
  return { code: "TRANSPORT", retryable: true };
};

// The harness marks these retryable but gives no wait time, so back off on our own.
const RETRY_CODES = new Set(["QLOO_RATE_LIMIT", "QLOO_UPSTREAM"]);

// One Qloo key serves every scout, so cap the calls in flight across the
// server and retry rate-limited calls a bounded number of times. A call keeps
// its slot while it waits, which also eases pressure on the rate limit.
export const limited = (call, { parallel = 3, delays = [1500, 4000] } = {}) => {
  let active = 0;
  const waiting = [];
  const acquire = async () => {
    if (active < parallel) active += 1;
    else await new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    // Hand the slot straight to the next caller so `active` never overshoots.
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return async (name, args, signal) => {
    await acquire();
    try {
      for (let attempt = 0; ; attempt += 1) {
        const envelope = await call(name, args, signal);
        if (!RETRY_CODES.has(envelope.error?.code) || attempt >= delays.length) return attempt ? { ...envelope, retries: attempt } : envelope;
        log("warn", "qloo_retry", { tool: name, code: envelope.error.code, attempt: attempt + 1, delay_ms: delays[attempt] });
        const stopped = await sleep(delays[attempt], false, { signal }).catch(() => true);
        if (stopped) return { ...envelope, retries: attempt };
      }
    } finally {
      release();
    }
  };
};

export const callQloo = limited(callOnce);

export const closeQloo = async () => {
  const pending = connection;
  connection = undefined;
  if (pending) await (await pending.catch(() => undefined))?.close();
};
