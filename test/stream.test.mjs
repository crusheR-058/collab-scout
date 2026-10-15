// The browser's event-stream reader, against a local server that misbehaves.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { serverEvents } from "../public/js/stream.js";

const serve = (handler) =>
  new Promise((resolve) => {
    const server = createServer(handler).listen(0, "127.0.0.1", () => resolve(server));
  });

const collect = async (url) => {
  const events = [];
  for await (const event of serverEvents(url, {})) events.push(event);
  return events;
};

test("garbled frames and heartbeats are skipped; good events still arrive", async (t) => {
  const server = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // Split one event across two writes, as a network would.
    res.write('data: {"type":"session","id":"1"}\n\n: keep-alive\n\ndata: {not json}\n\ndata: [1]\n\ndata: {"type":"te');
    res.end('xt","text":"hi"}\n\n');
  });
  t.after(() => server.close());
  const events = await collect(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(events, [
    { type: "session", id: "1" },
    { type: "text", text: "hi" },
  ]);
});

test("an error response becomes an Error with the server's message", async (t) => {
  const server = await serve((_req, res) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Slow down." }));
  });
  t.after(() => server.close());
  await assert.rejects(collect(`http://127.0.0.1:${server.address().port}/`), /Slow down\./);
});

test("an error response without JSON names the status", async (t) => {
  const server = await serve((_req, res) => {
    res.writeHead(502);
    res.end("<html>Bad gateway</html>");
  });
  t.after(() => server.close());
  await assert.rejects(collect(`http://127.0.0.1:${server.address().port}/`), /answered 502/);
});
