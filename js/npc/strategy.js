// NPC throw strategies: pure functions, no DOM. An NPC's personality is a spec made of small behaviours
// (based on habits real players show) mixed by weight, plus noise so nobody is a sure thing.
// The NPC always plans its throw BEFORE the player's throw is read, from earlier throws only.
import { GESTURES, GESTURE_KEYS } from "../gesture.js";

const UNIFORM = [1 / 3, 1 / 3, 1 / 3];
const idx = (g) => GESTURE_KEYS.indexOf(g);
const oneHot = (g) => GESTURE_KEYS.map((k) => (k === g ? 1 : 0));
/** The throw that beats g. */
export const beats = (g) => GESTURE_KEYS.find((k) => GESTURES[k].beats === g);
/** Next in the rock → paper → scissors cycle. */
export const next = (g) => GESTURE_KEYS[(idx(g) + 1) % 3];

function normalize(d) {
  const s = d.reduce((a, b) => a + b, 0);
  return s > 0 ? d.map((v) => v / s) : [...UNIFORM];
}
const mix = (d, t, w) => d.map((v, i) => (1 - w) * v + w * t[i]);
const fromBias = (bias) => (bias ? normalize(GESTURE_KEYS.map((k) => bias[k] ?? 0)) : [...UNIFORM]);

/** Counter a predicted distribution of the player's throw: put its weight on what beats each throw. */
function counterOf(pred) {
  const out = [0, 0, 0];
  GESTURE_KEYS.forEach((g, i) => (out[idx(beats(g))] += pred[i]));
  return out;
}

/** Predict the player's next throw from what they threw after the same last `order` throws before. */
function markovPredict(seq, order) {
  if (seq.length <= order) return null;
  const key = seq.slice(-order).join();
  const counts = [0, 0, 0];
  for (let i = order; i < seq.length; i++) if (seq.slice(i - order, i).join() === key) counts[idx(seq[i])]++;
  const n = counts.reduce((a, b) => a + b, 0);
  return n ? counts.map((c) => c / n) : null;
}

/**
 * Behaviours. Each returns a target distribution [rock, paper, scissors] for the NPC's throw, or null
 * when it has nothing to say this turn. `c` is the context built in `situation()`.
 */
export const BEHAVIOURS = {
  opener: (c, b) => (c.roundStart ? oneHot(b.g) : null),
  fixed: (c, b) => oneHot(b.g),
  winStay: (c) => (c.last?.result === "win" ? oneHot(c.last.npc) : null),
  loseShift: (c) => (c.last?.result === "lose" ? oneHot(next(c.last.npc)) : null),
  cycle: (c) => (c.last ? oneHot(next(c.last.npc)) : null),
  copy: (c) => (c.last ? oneHot(c.last.player) : null),
  counterLast: (c) => (c.last ? oneHot(beats(c.last.player)) : null),
  // Expects you to beat the copy, and beats that.
  counterCounter: (c) => (c.last ? oneHot(beats(beats(c.last.player))) : null),
  counterFavourite: (c) => {
    const seq = c.playerSeq;
    if (seq.length < 2) return null;
    const counts = GESTURE_KEYS.map((g) => seq.filter((x) => x === g).length);
    const top = Math.max(...counts);
    return counterOf(normalize(counts.map((n) => (n === top ? 1 : 0))));
  },
  markov: (c, b) => {
    for (let order = b.order ?? 2; order >= 1; order--) {
      const p = markovPredict(c.playerSeq, order);
      if (p) return counterOf(p);
    }
    return null;
  },
  random: () => [...UNIFORM],
};
export const MASKS = {
  // Never the same throw twice in a row.
  noRepeat: (c, d) => (c.last ? d.map((v, i) => (GESTURE_KEYS[i] === c.last.npc ? 0 : v)) : d),
};

const CONDITIONS = {
  first: (c) => c.roundStart,
  afterWin: (c) => c.last?.result === "win",
  afterLoss: (c) => c.last?.result === "lose",
  afterDraw: (c) => c.last?.result === "draw",
  lostTwo: (c) => c.history.length >= 2 && c.history.slice(-2).every((h) => h.result === "lose"),
  ahead: (c) => c.npcHp > c.playerHp,
  behind: (c) => c.npcHp < c.playerHp,
  lowHp: (c) => c.npcHp <= c.maxHp / 2,
};
const holds = (c, when) => !when || (CONDITIONS[when]?.(c) ?? false);

/**
 * history: this match's exchanges from the NPC's side: [{ npc, player, result: "win" | "lose" | "draw" }].
 * memory: the player's throws from earlier matches (only NPCs with `useMemory` look at it).
 * roundStart: true on a round's first throw (defaults to "no history yet").
 */
export function situation(spec, { history = [], memory = [], npcHp = 100, playerHp = 100, maxHp = 100, roundStart } = {}) {
  const own = history.map((h) => h.player);
  return {
    history,
    roundStart: roundStart ?? history.length === 0, // first throw of a round
    last: history[history.length - 1] || null,
    playerSeq: spec.useMemory ? [...memory, ...own] : own,
    npcHp, playerHp, maxHp,
  };
}

/** The spec with any active moods applied (moods can change bias and noise, and add behaviours). */
export function activeSpec(spec, c) {
  let s = { ...spec, behaviours: [...(spec.behaviours || [])], masks: [...(spec.masks || [])] };
  for (const m of spec.mood || []) {
    if (!holds(c, m.when)) continue;
    if (m.bias) s.bias = m.bias;
    if (m.noise !== undefined) s.noise = m.noise;
    if (m.behaviours) s.behaviours.push(...m.behaviours);
    if (m.replace) s.behaviours = [...m.replace];
  }
  return s;
}

/** Probability of each throw for the NPC's next throw. `noiseScale` < 1 makes NPCs easier to read. */
export function throwOdds(spec, ctx = {}, { noiseScale = 1 } = {}) {
  const c = situation(spec, ctx);
  const s = activeSpec(spec, c);
  let d = fromBias(s.bias);
  for (const b of s.behaviours) {
    if (!holds(c, b.when)) continue;
    const t = BEHAVIOURS[b.type]?.(c, b);
    if (t) d = mix(d, normalize(t), b.w ?? 1);
  }
  const noise = Math.min(1, Math.max(0, (s.noise ?? 0.2) * noiseScale));
  d = mix(d, UNIFORM, noise);
  // Masks are hard rules (e.g. never repeat), so they apply after the noise.
  for (const m of s.masks) d = normalize(MASKS[m]?.(c, d) ?? d);
  return normalize(d);
}

function sample(d, rng) {
  let r = rng();
  for (let i = 0; i < 3; i++) if ((r -= d[i]) < 0) return GESTURE_KEYS[i];
  return GESTURE_KEYS[2];
}

/**
 * Plan the NPC's next throw. Returns { gesture, odds, tell } where `tell` is the tell text to show
 * during the countdown, or null. Tells come from the planned throw, so they're honest (but not certain).
 */
export function planThrow(spec, ctx = {}, { rng = Math.random, noiseScale = 1 } = {}) {
  const odds = throwOdds(spec, ctx, { noiseScale });
  const gesture = sample(odds, rng);
  let tell = null;
  const t = spec.tell;
  if (t) {
    const roll = rng();
    if (gesture === t.before ? roll < (t.chance ?? 0.7) : roll < (t.falseChance ?? 0.1)) tell = t.text;
  }
  return { gesture, odds, tell };
}

/**
 * Pick a power-up to arm for this throw (or null). `held` = POWER keys the NPC can use right now.
 * Policies: never | sometimes | whenBehind | always.
 */
export function planPower(spec, { held = [], npcHp = 100, playerHp = 100 } = {}, { rng = Math.random } = {}) {
  if (!held.length) return null;
  const pick = (prefs) => prefs.find((p) => held.includes(p)) || held[Math.floor(rng() * held.length)];
  switch (spec.powers || "sometimes") {
    case "never":
      return null;
    case "always":
      return pick(["power", "reverse", "shield"]);
    case "whenBehind":
      return npcHp < playerHp && rng() < 0.6 ? pick(["reverse", "shield", "power"]) : null;
    default:
      return rng() < 0.25 ? held[Math.floor(rng() * held.length)] : null;
  }
}

/** Check a spec only uses known behaviours, masks, conditions and throws (used by tests and at load). */
export function validateSpec(spec) {
  const errs = [];
  const gest = (g) => g === undefined || GESTURE_KEYS.includes(g);
  const checkB = (b) => {
    if (!BEHAVIOURS[b.type]) errs.push(`unknown behaviour ${b.type}`);
    if (b.when && !CONDITIONS[b.when]) errs.push(`unknown condition ${b.when}`);
    if (!gest(b.g)) errs.push(`bad throw ${b.g}`);
    if ((b.type === "opener" || b.type === "fixed") && !b.g) errs.push(`${b.type} needs g`);
  };
  (spec.behaviours || []).forEach(checkB);
  (spec.masks || []).forEach((m) => MASKS[m] || errs.push(`unknown mask ${m}`));
  for (const m of spec.mood || []) {
    if (!CONDITIONS[m.when]) errs.push(`unknown mood condition ${m.when}`);
    (m.behaviours || []).forEach(checkB);
    (m.replace || []).forEach(checkB);
  }
  if (spec.bias) Object.keys(spec.bias).forEach((k) => gest(k) || errs.push(`bad bias key ${k}`));
  if (spec.tell && !gest(spec.tell.before)) errs.push("bad tell throw");
  if (spec.powers && !["never", "sometimes", "whenBehind", "always"].includes(spec.powers)) errs.push("bad powers policy");
  return errs;
}
