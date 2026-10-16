// What the page knows about the scout on screen.
export const state = {
  sessionId: undefined,
  // True when this scout was started in this page load, so the server still holds it.
  live: false,
  briefText: "",
  brief: undefined,
  // Partnership plans for this scout, newest first.
  plans: [],
  // The share link's token, if this scout is shared.
  share: null,
  calls: new Map(),
  callCount: 0,
  notes: [],
  lastError: undefined,
};

export const resetState = (briefText) => {
  Object.assign(state, {
    sessionId: undefined,
    live: true,
    briefText,
    brief: undefined,
    plans: [],
    share: null,
    callCount: 0,
    notes: [],
    lastError: undefined,
  });
  state.calls.clear();
};
