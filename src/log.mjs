// One JSON line per event, so logs can be searched by request or research ID.
// Callers pass identifiers and codes, never brief text, keys or Qloo payloads.
export const counters = {};

export const log = (level, event, fields = {}) => {
  counters[event] = (counters[event] ?? 0) + 1;
  const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
};
