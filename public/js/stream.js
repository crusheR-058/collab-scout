// POSTs to the server and yields the scout's events as they arrive.
export async function* serverEvents(url, body, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error ?? `The server answered ${response.status}.`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const frames = buffer.split("\n\n");
    buffer = frames.pop();
    for (const frame of frames) {
      if (!frame.startsWith("data: ")) continue;
      let event;
      try {
        event = JSON.parse(frame.slice(6));
      } catch {
        // One garbled event should not end the scout; skip it.
        continue;
      }
      if (typeof event?.type === "string") yield event;
    }
  }
}
