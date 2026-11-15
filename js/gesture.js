// Hand-landmark → Rock / Paper / Scissors classifier.
// Works on MediaPipe's 21-point hand model. Uses distances from the wrist,
// so it is independent of hand rotation and distance from the camera.

export const GESTURES = {
  rock: { emoji: "✊", label: "Rock", beats: "scissors" },
  paper: { emoji: "✋", label: "Paper", beats: "rock" },
  scissors: { emoji: "✌️", label: "Scissors", beats: "paper" },
};
export const GESTURE_KEYS = Object.keys(GESTURES);

// [pip, tip] landmark indices for index, middle, ring, pinky.
const FINGERS = [
  [6, 8],
  [10, 12],
  [14, 16],
  [18, 20],
];
const EXTENDED = 1.15; // tip/pip distance ratio above which a finger counts as straight
const CURLED = 1.0; // below this a finger is clearly folded; in between it's half-open
const THUMB_OUT = 0.85; // thumb tip → middle knuckle, over palm length, above which the thumb sticks out

/**
 * Shapes that are a hand but not a legal throw. They're reported so the player sees what went
 * wrong ("3 fingers") instead of a silent "no hand". `hint` says how to fix it.
 */
export const FOULS = {
  one: { label: "1 finger", hint: "Rock is a fist, Scissors is index + middle" },
  gun: { label: "Finger gun", hint: "Scissors is index + middle, thumb tucked" },
  three: { label: "3 fingers", hint: "Paper needs all 4 fingers open" },
  badScissors: { label: "Wrong scissors", hint: "Scissors is index + middle only" },
};

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

/** Ratio of wrist→tip over wrist→pip for each finger (~1.35 straight, ~0.8 curled). */
export function fingerRatios(lm) {
  const wrist = lm[0];
  return FINGERS.map(([pip, tip]) => dist(wrist, lm[tip]) / dist(wrist, lm[pip]));
}

/** True when the thumb sticks out sideways (finger gun / L shape) rather than lying over the fist. */
export function thumbOut(lm) {
  return dist(lm[4], lm[9]) / dist(lm[0], lm[9]) > THUMB_OUT;
}

/**
 * Classify one hand.
 * @param {{x:number,y:number,z?:number}[]} lm 21 landmarks (world landmarks preferred)
 * `power` names the power-up a sign stands for (see POWERS in fight.js). Those signs are fouls
 * as a throw, but held between throws they arm a power-up: finger gun = power, horns = reverse,
 * index finger up = shield.
 * @returns {{gesture: string|null, foul: string|null, power: string|null, confidence: number, extended: boolean[], thumb: boolean}}
 */
export function classify(lm) {
  if (!lm || lm.length < 21) return { gesture: null, foul: null, power: null, confidence: 0, extended: [], thumb: false };
  const ratios = fingerRatios(lm);
  const ext = ratios.map((r) => r > EXTENDED);
  const curled = ratios.map((r) => r < CURLED);
  const [index, middle, ring, pinky] = ext;
  const n = ext.filter(Boolean).length;
  const thumb = thumbOut(lm);

  let gesture = null;
  let foul = null;
  if (n === 0) gesture = "rock";
  else if (index && middle && !ring && !pinky) gesture = "scissors";
  else if (n === 4) gesture = "paper";
  // 3 straight and the 4th only half-folded is still an open hand (the pinky often reads short).
  else if (n === 3 && index && middle && !curled[ext.indexOf(false)]) gesture = "paper";
  else if (n === 3) foul = "three";
  else if (n === 1) foul = index && thumb ? "gun" : "one";
  else if (n === 2) foul = "badScissors"; // horns, middle + ring, etc.

  let power = null;
  if (foul === "gun") power = "power";
  else if (foul === "one" && index) power = "shield";
  else if (foul === "badScissors" && index && pinky) power = "reverse";

  // Confidence: how clearly the least-certain finger sits on its side of the threshold.
  const margin = Math.min(...ratios.map((r) => Math.abs(r - EXTENDED)));
  const confidence = gesture || foul ? Math.min(1, 0.4 + margin * 3) : 0;
  return { gesture, foul, power, confidence, extended: ext, thumb };
}

/** Rolling buffer of recent classifications, used to smooth jitter and read the throw at "Shoot!". */
export class GestureBuffer {
  constructor(maxAgeMs = 1500) {
    this.maxAgeMs = maxAgeMs;
    this.items = [];
  }
  push(gesture, t = performance.now(), foul = null) {
    this.items.push({ gesture, foul: gesture ? null : foul, t });
    while (this.items.length && t - this.items[0].t > this.maxAgeMs) this.items.shift();
  }
  /** Most common non-null gesture between [from, to]; null if too few votes. */
  vote(from, to, minShare = 0.5) {
    const slice = this.items.filter((i) => i.t >= from && i.t <= to);
    if (!slice.length) return null;
    const counts = {};
    for (const { gesture } of slice) if (gesture) counts[gesture] = (counts[gesture] || 0) + 1;
    let best = null;
    let bestN = 0;
    for (const [g, c] of Object.entries(counts)) if (c > bestN) [best, bestN] = [g, c];
    return best && bestN / slice.length >= minShare ? best : null;
  }
  /**
   * Latest unbroken run of one value (`key` = "gesture" or "foul") lasting at least `minFrames`
   * frames or `holdMs`. A single dropped frame (tracker blinked) doesn't break a run; a different
   * shape does. Returns { held, last }: the latest held value, and the last value seen at all.
   */
  _runs(from, to, key, minFrames, holdMs) {
    const other = key === "gesture" ? "foul" : "gesture";
    let held = null;
    let last = null;
    let run = null;
    let gap = 0;
    for (const it of this.items) {
      if (it.t < from || it.t > to) continue;
      const v = it[key];
      if (!v) {
        // A different kind of shape ends the run; one empty frame is forgiven, two are not.
        if (it[other] || ++gap > 1) run = null;
        continue;
      }
      gap = 0;
      last = v;
      if (run && run.v === v) {
        run.n++;
        run.end = it.t;
      } else run = { v, n: 1, start: it.t, end: it.t };
      if (run.n >= minFrames || run.end - run.start >= holdMs) held = run.v;
    }
    return { held, last };
  }
  /**
   * The gesture the hand settled on last in [from, to]. Earlier gestures (like the fist people
   * pump during the countdown) are ignored, so a late change to scissors counts as scissors.
   * Falls back to the last gesture seen if no run is long enough; null if no gesture at all.
   */
  settled(from, to, { minFrames = 3, holdMs = 90 } = {}) {
    const { held, last } = this._runs(from, to, "gesture", minFrames, holdMs);
    return held || last;
  }
  /**
   * The throw for [from, to]: { gesture, foul }. A legal gesture always wins; otherwise the foul
   * the hand held (e.g. "three"), so the player can be told what was wrong. Both null = no hand.
   */
  read(from, to, opts = {}) {
    const gesture = this.settled(from, to, opts);
    if (gesture) return { gesture, foul: null };
    const { held, last } = this._runs(from, to, "foul", opts.minFrames ?? 3, opts.holdMs ?? 90);
    return { gesture: null, foul: held || last };
  }
  /** True once the hand has held a legal gesture in [from, to] (used to stop waiting early). */
  hasSettled(from, to, { minFrames = 3, holdMs = 90 } = {}) {
    return !!this._runs(from, to, "gesture", minFrames, holdMs).held;
  }
  clear() {
    this.items = [];
  }
}

/** "win" | "lose" | "draw" from the player's point of view. */
export function outcome(player, cpu) {
  if (player === cpu) return "draw";
  return GESTURES[player].beats === cpu ? "win" : "lose";
}
