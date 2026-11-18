// School progress, saved in the browser (no account). Versioned so later milestones can add fields,
// and movable between devices with a save code. Rio's memory of your throws lives in its own key
// (js/duel/opponents.js) because VS CPU uses it too.

export const SAVE_KEY = "handduel-school";
export const SAVE_V = 1;
const CODE_PREFIX = "HD1.";
const FACES = ["up", "down", "left", "right"];
export const STAMPS = ["stone", "paper", "blade", "mirror", "final"];

export function freshSave() {
  return {
    v: SAVE_V, map: null, x: null, y: null, face: "down", record: {}, flags: {}, started: Date.now(),
    name: "", avatar: null, stamps: [], coins: 0, items: [], chapter: 0, goal: "",
  };
}

const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
const int = (n) => (Number.isInteger(n) && n >= 0 ? n : null);

/** Anything read back (storage or a code) goes through here: unknown or bad fields are dropped. */
export function migrate(raw) {
  if (!isObj(raw) || typeof raw.v !== "number" || raw.v > SAVE_V) return freshSave();
  const s = freshSave();
  if (typeof raw.map === "string" && /^[a-z0-9-]{1,32}$/.test(raw.map)) s.map = raw.map;
  s.x = int(raw.x);
  s.y = int(raw.y);
  if (s.x === null || s.y === null) s.x = s.y = null;
  if (FACES.includes(raw.face)) s.face = raw.face;
  if (isObj(raw.record))
    for (const [id, r] of Object.entries(raw.record))
      if (/^[a-z0-9-]{1,32}$/.test(id) && isObj(r)) s.record[id] = { w: int(r.w) ?? 0, l: int(r.l) ?? 0 };
  if (isObj(raw.flags)) for (const [k, v] of Object.entries(raw.flags)) if (/^[A-Za-z0-9_]{1,40}$/.test(k) && typeof v === "boolean") s.flags[k] = v;
  if (typeof raw.started === "number") s.started = raw.started;
  if (typeof raw.name === "string") s.name = raw.name.replace(/[^\p{L}\p{N} ._'-]/gu, "").slice(0, 16);
  if (isObj(raw.avatar)) s.avatar = raw.avatar; // checked item by item by js/art/avatar.js normalizeAvatar
  if (Array.isArray(raw.stamps)) s.stamps = STAMPS.filter((k) => raw.stamps.includes(k));
  s.coins = Math.min(int(raw.coins) ?? 0, 99999);
  if (Array.isArray(raw.items)) s.items = [...new Set(raw.items.filter((i) => typeof i === "string" && /^[a-z]+:[a-z0-9-]{1,24}$/.test(i)))];
  if (int(raw.chapter) !== null) s.chapter = Math.min(raw.chapter, 9);
  if (typeof raw.goal === "string") s.goal = raw.goal.slice(0, 120);
  return s;
}

export function loadSave(storage = globalThis.localStorage) {
  try {
    return migrate(JSON.parse(storage.getItem(SAVE_KEY) || "null"));
  } catch {
    return freshSave();
  }
}

export function writeSave(s, storage = globalThis.localStorage) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false; // private mode or full: progress lasts for this visit
  }
}

export function recordDuel(s, id, won) {
  const r = (s.record[id] ??= { w: 0, l: 0 });
  if (won) r.w++;
  else r.l++;
  return r;
}

export const beaten = (s, id) => (s.record[id]?.w ?? 0) > 0;

/**
 * Story conditions used by maps and scripts. A string or a list (all must hold):
 * "flag" set, "!flag" not set, "beat:id" / "!beat:id" (won a duel against id), "stamp:stone", "chapter>=2".
 */
export function check(s, cond) {
  if (cond === undefined || cond === null || cond === "") return true;
  if (Array.isArray(cond)) return cond.every((c) => check(s, c));
  const neg = cond.startsWith("!");
  const c = neg ? cond.slice(1) : cond;
  let v;
  if (c.startsWith("beat:")) v = beaten(s, c.slice(5));
  else if (c.startsWith("stamp:")) v = s.stamps.includes(c.slice(6));
  else if (c.startsWith("chapter>=")) v = s.chapter >= Number(c.slice(9));
  else v = !!s.flags[c];
  return neg ? !v : v;
}

// Save codes: the save as base64url JSON with a short prefix. Not secret, not tamper-proof: it's a single-player game.
// UTF-8 safe (names can have accents or other scripts).
const b64 = (str) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (str) =>
  new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)));

export function exportCode(s) {
  return CODE_PREFIX + b64(JSON.stringify(migrate(s)));
}

/** A save code back to a save. Throws a readable error if the code isn't one. */
export function importCode(code) {
  const c = String(code || "").replace(/\s+/g, "");
  if (!c.startsWith(CODE_PREFIX)) throw new Error("That isn't a Hand Duel save code.");
  let raw;
  try {
    raw = JSON.parse(unb64(c.slice(CODE_PREFIX.length)));
  } catch {
    throw new Error("That save code is damaged. Copy it again in full.");
  }
  if (!isObj(raw) || typeof raw.v !== "number") throw new Error("That save code is damaged. Copy it again in full.");
  if (raw.v > SAVE_V) throw new Error("That code is from a newer version of the game. Reload the page and try again.");
  return migrate(raw);
}
