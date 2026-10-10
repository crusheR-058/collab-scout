// What the page knows about the scout on screen.
export const state = {
  sessionId: undefined,
  // True when this scout was started in this page load, so the server still holds it.
  live: false,
  briefText: "",
  brief: undefined,
  calls: new Map(),
  callCount: 0,
  notes: [],
  // Plain record of the field log, kept so a finished scout can be reopened.
  entries: [],
  lastError: undefined,
};

export const resetState = (briefText) => {
  Object.assign(state, {
    sessionId: undefined,
    live: true,
    briefText,
    brief: undefined,
    callCount: 0,
    notes: [],
    entries: [],
    lastError: undefined,
  });
  state.calls.clear();
};
