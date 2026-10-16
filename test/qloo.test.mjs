// The Qloo adapter's concurrency cap and retries, with a fake call.
import assert from "node:assert/strict";
import { test } from "node:test";
import { limited } from "../src/qloo.mjs";
import { A, ok } from "./fixtures.mjs";

const quiet = (t) => t.mock.method(console, "warn", () => {});
const failure = (code) => ({ status: "error", summary: code, error: { code, retryable: true } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("no more than `parallel` calls are in flight at once", async () => {
  let active = 0;
  let peak = 0;
  const call = limited(
    async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick();
      active -= 1;
      return ok([A]);
    },
    { parallel: 3 },
  );
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => call("qloo_describe", { entity: `E${index}` })));
  assert.equal(peak, 3);
  assert.equal(results.length, 10);
  assert.ok(results.every((result) => result.status === "ok"));
});

test("a rate-limited call is retried, then succeeds", async (t) => {
  quiet(t);
  const replies = [failure("QLOO_RATE_LIMIT"), failure("QLOO_RATE_LIMIT"), ok([A])];
  const call = limited(async () => replies.shift(), { delays: [1, 1] });
  assert.equal((await call("qloo_rank", {})).status, "ok");
  assert.equal(replies.length, 0);
});

test("retries stop after the last delay and return Qloo's error", async (t) => {
  quiet(t);
  let attempts = 0;
  const call = limited(async () => (attempts++, failure("QLOO_UPSTREAM")), { delays: [1, 1] });
  assert.equal((await call("qloo_rank", {})).error.code, "QLOO_UPSTREAM");
  assert.equal(attempts, 3);
});

test("other errors are not retried", async () => {
  let attempts = 0;
  const call = limited(async () => (attempts++, failure("TOOL_INPUT")), { delays: [1, 1] });
  await call("qloo_rank", {});
  assert.equal(attempts, 1);
});

test("stopping the scout ends the retry wait", async (t) => {
  quiet(t);
  let attempts = 0;
  const controller = new AbortController();
  const call = limited(async () => (attempts++, failure("QLOO_RATE_LIMIT")), { delays: [60_000, 60_000] });
  const pending = call("qloo_rank", {}, controller.signal);
  await tick();
  controller.abort();
  const started = Date.now();
  assert.equal((await pending).error.code, "QLOO_RATE_LIMIT");
  assert.ok(Date.now() - started < 1000);
  assert.equal(attempts, 1);
});

test("a slot is released after a call, so later calls still run", async () => {
  const call = limited(async () => ok([A]), { parallel: 1 });
  for (let index = 0; index < 5; index += 1) assert.equal((await call("qloo_describe", {})).status, "ok");
});
