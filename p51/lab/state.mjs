// Tiny pub/sub state store — no dependencies.
const listeners = new Set();
const state = {
  health: null,
  providers: null,
  generations: [],
  filter: 'visible',          // 'visible' | 'starred' | 'hidden' | 'all'
  searchQuery: '',
  selectedId: null,           // currently-previewed generation
  previewSource: 'approved',  // 'approved' | 'selected'
  status: 'idle',             // 'idle' | 'running' | 'error'
  trace: [],                  // SSE event log
  tunables: {},               // key -> value
};

export function getState() { return state; }
export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
