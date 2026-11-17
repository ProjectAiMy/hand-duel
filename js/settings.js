// Player settings, saved on this device (localStorage). Reads never throw: blocked storage just means defaults.

const KEY = "handduel-settings";

export const DEFAULTS = Object.freeze({
  // audio
  master: 80, // 0-100
  muted: false,
  sfx: true,
  music: true,
  // display & performance
  quality: "medium", // camera capture: low 480p, medium 720p, high 1080p
  lite: false, // no blur or particles, for slow devices
  // tracking
  mirror: true,
  skeleton: true,
  cursor: true, // point at buttons and hold to press
  smoothing: 50, // 0 = snappy, 100 = steady
  speed: 1.5, // cursor gain: 1 = hand travels the whole camera frame, 2.5 = small moves reach the edges
  dwell: 800, // ms to hold over a button to press it
  // game
  autoNext: true,
  arena: "random",
  pipAnchor: "br", // where your own video tile sits in spotlight layout
  pipSize: 1, // 0 small, 1 medium, 2 large
});

const RANGES = { master: [0, 100], smoothing: [0, 100], speed: [1, 2.5], dwell: [300, 2000], pipSize: [0, 2] };

let state = load();
const subs = new Set();

function load() {
  try {
    return clean({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") });
  } catch {
    return { ...DEFAULTS };
  }
}

/** Drop unknown keys and wrong types, clamp numbers: storage can hold anything. */
export function clean(obj) {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = obj?.[k];
    if (typeof v !== typeof DEFAULTS[k]) continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      const r = RANGES[k];
      out[k] = r ? Math.min(r[1], Math.max(r[0], v)) : v;
    } else out[k] = v;
  }
  return out;
}

export const get = (k) => state[k];
export const all = () => ({ ...state });

export function set(k, v) {
  if (!(k in DEFAULTS)) return;
  const next = clean({ ...state, [k]: v });
  if (next[k] === state[k]) return;
  state = next;
  save();
  subs.forEach((fn) => fn(k, state[k]));
}

export function reset() {
  const keep = { pipAnchor: state.pipAnchor }; // a layout choice, not a "setting" people expect reset
  state = { ...DEFAULTS, ...keep };
  save();
  subs.forEach((fn) => fn(null, null));
}

/** fn(key, value) on every change; key is null after a reset. */
export function onChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* not saved; still applies for this visit */
  }
}
