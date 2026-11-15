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

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

/** Ratio of wrist→tip over wrist→pip for each finger (~1.35 straight, ~0.8 curled). */
export function fingerRatios(lm) {
  const wrist = lm[0];
  return FINGERS.map(([pip, tip]) => dist(wrist, lm[tip]) / dist(wrist, lm[pip]));
}

/**
 * Classify one hand.
 * @param {{x:number,y:number,z?:number}[]} lm 21 landmarks (world landmarks preferred)
 * @returns {{gesture: string|null, confidence: number, extended: boolean[]}}
 */
export function classify(lm) {
  if (!lm || lm.length < 21) return { gesture: null, confidence: 0, extended: [] };
  const ratios = fingerRatios(lm);
  const ext = ratios.map((r) => r > EXTENDED);
  const [index, middle, ring, pinky] = ext;
  const n = ext.filter(Boolean).length;

  let gesture = null;
  if (n === 0) gesture = "rock";
  else if (index && middle && !ring && !pinky) gesture = "scissors";
  else if (n >= 3 && index && middle) gesture = "paper";

  // Confidence: how clearly the least-certain finger sits on its side of the threshold.
  const margin = Math.min(...ratios.map((r) => Math.abs(r - EXTENDED)));
  const confidence = gesture ? Math.min(1, 0.4 + margin * 3) : 0;
  return { gesture, confidence, extended: ext };
}

/** Rolling buffer of recent classifications, used to smooth jitter and vote at "Shoot!". */
export class GestureBuffer {
  constructor(maxAgeMs = 1500) {
    this.maxAgeMs = maxAgeMs;
    this.items = [];
  }
  push(gesture, t = performance.now()) {
    this.items.push({ gesture, t });
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
  clear() {
    this.items = [];
  }
}

/** "win" | "lose" | "draw" from the player's point of view. */
export function outcome(player, cpu) {
  if (player === cpu) return "draw";
  return GESTURES[player].beats === cpu ? "win" : "lose";
}
