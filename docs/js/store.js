// App state, cached on the phone so everything reads offline. Grocery checkmarks and
// favorites made offline go into a queue and sync on reconnect.
import * as api from './api.js';

const STATE_KEY = 'tsmenu.state.v1';
const QUEUE_KEY = 'tsmenu.queue.v1';
const SYNC_KEY = 'tsmenu.lastSync';

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}

export const store = {
  state: readJson(STATE_KEY, null),
  queue: readJson(QUEUE_KEY, []),
  lastSync: localStorage.getItem(SYNC_KEY) || '',
  online: navigator.onLine,
  loading: false,
  subs: new Set(),
};

export function subscribe(fn) { store.subs.add(fn); return () => store.subs.delete(fn); }
function emit() { store.subs.forEach((fn) => fn(store)); }

// Changes that can be applied on the phone first and replayed to the server later.
function applyLocal(state, op) {
  if (!state) return;
  if (op.action === 'setGroceryItemChecked') {
    if (op.args.checked) state.checks[op.args.itemKey] = true;
    else delete state.checks[op.args.itemKey];
  } else if (op.action === 'setFavorite') {
    const r = state.recipes.find((x) => x.RecipeID === op.args.id);
    if (r) r.IsFavorite = !!op.args.value;
  }
}

function opKey(op) { return op.action + ':' + (op.args.itemKey || op.args.id); }

function saveQueue() { localStorage.setItem(QUEUE_KEY, JSON.stringify(store.queue)); }

export function setState(state) {
  // Changes still waiting to sync stay visible on top of fresh server data.
  store.queue.forEach((op) => applyLocal(state, op));
  store.state = state;
  store.lastSync = new Date().toISOString();
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    localStorage.setItem(SYNC_KEY, store.lastSync);
  } catch (e) { /* storage full — keep going in memory */ }
  emit();
}

function setOnline(on) {
  if (store.online !== on) { store.online = on; emit(); }
}

/** Pulls everything fresh from the sheet (after sending anything queued). */
export async function refresh() {
  store.loading = true; emit();
  try {
    await flush();
    const state = await api.get('bootstrap');
    setOnline(true);
    setState(state);
  } catch (err) {
    if (err.offline) setOnline(false);
    throw err;
  } finally {
    store.loading = false; emit();
  }
}

/** A write that needs the server. Uses the fresh state it returns, if any. */
export async function write(action, args) {
  try {
    const data = await api.post(action, args);
    setOnline(true);
    if (data && data.state) setState(data.state);
    return data;
  } catch (err) {
    if (err.offline) setOnline(false);
    throw err;
  }
}

/** A change applied right away, synced whenever possible. */
export function queued(action, args) {
  const op = { action, args };
  applyLocal(store.state, op);
  store.queue = store.queue.filter((o) => opKey(o) !== opKey(op)).concat([op]);
  saveQueue();
  try { localStorage.setItem(STATE_KEY, JSON.stringify(store.state)); } catch (e) { /* ignore */ }
  emit();
  flush().catch(() => {});
}

let flushing = null;
export function flush() {
  if (!store.queue.length) return Promise.resolve();
  if (flushing) return flushing;
  const ops = store.queue.slice();
  flushing = api.post('applyQueuedChanges', { ops }).then((data) => {
    store.queue = store.queue.filter((o) => !ops.includes(o));
    saveQueue();
    setOnline(true);
    setState(data.state);
  }).catch((err) => {
    if (err.offline) setOnline(false);
    throw err;
  }).finally(() => { flushing = null; });
  return flushing;
}

window.addEventListener('online', () => { setOnline(true); flush().catch(() => {}); });
window.addEventListener('offline', () => setOnline(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flush().catch(() => {});
});
