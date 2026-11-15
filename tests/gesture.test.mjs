// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, outcome, GestureBuffer } from "../js/gesture.js";

// Build a synthetic 21-point hand (cm units). fingers: [index, middle, ring, pinky] straight?
// rot rotates the whole hand in the image plane to check rotation invariance.
function hand([i, m, r, p], rot = 0, { thumb = false, half = [] } = {}) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  // thumb: tucked along the fist, or sticking out sideways (finger gun)
  [1, 2, 3, 4].forEach((k, n) => (pts[k] = thumb ? { x: -3 - n * 2.2, y: 2 + n * 2.6, z: 0 } : { x: -3 - n, y: 2 + n * 1.5, z: 0 }));
  const xs = [-2, 0, 2, 3.8];
  const straight = [i, m, r, p];
  [5, 9, 13, 17].forEach((mcp, f) => {
    const x = xs[f];
    pts[mcp] = { x, y: 8, z: 0 };
    pts[mcp + 1] = { x, y: 12, z: 0 }; // pip
    if (half.includes(f)) {
      pts[mcp + 2] = { x, y: 13.5, z: -1 }; // half-open: between straight and curled
      pts[mcp + 3] = { x, y: 13.6, z: -2.5 };
    } else if (straight[f]) {
      pts[mcp + 2] = { x, y: 14.5, z: 0 };
      pts[mcp + 3] = { x, y: 16.5, z: 0 };
    } else {
      pts[mcp + 2] = { x, y: 11, z: -2 }; // curled back toward palm
      pts[mcp + 3] = { x, y: 8.5, z: -2 };
    }
  });
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return pts.map(({ x, y, z }) => ({ x: x * c - y * s, y: x * s + y * c, z }));
}

for (const rot of [0, Math.PI / 2, Math.PI, -0.7]) {
  test(`classifies shapes at rotation ${rot.toFixed(2)}`, () => {
    assert.equal(classify(hand([0, 0, 0, 0], rot)).gesture, "rock");
    assert.equal(classify(hand([1, 1, 1, 1], rot)).gesture, "paper");
    assert.equal(classify(hand([1, 1, 0, 0], rot)).gesture, "scissors");
  });
}

test("ambiguous shapes are rejected", () => {
  assert.equal(classify(hand([1, 0, 0, 0])).gesture, null); // pointing
  assert.equal(classify(hand([0, 1, 0, 0])).gesture, null);
  assert.equal(classify(hand([1, 0, 0, 1])).gesture, null); // horns
  assert.equal(classify([]).gesture, null);
  assert.equal(classify([]).foul, null);
});

test("illegal shapes are reported as fouls", () => {
  const foul = (f, opts) => classify(hand(f, 0, opts));
  assert.equal(foul([1, 0, 0, 0]).foul, "one");
  assert.equal(foul([0, 1, 0, 0]).foul, "one");
  assert.equal(foul([1, 0, 0, 0], { thumb: true }).foul, "gun");
  assert.equal(foul([1, 1, 1, 0]).foul, "three");
  assert.equal(foul([0, 1, 1, 1]).foul, "three");
  assert.equal(foul([1, 0, 0, 1]).foul, "badScissors"); // horns
  assert.equal(foul([0, 1, 1, 0]).foul, "badScissors");
  assert.equal(foul([1, 0, 1, 0]).foul, "badScissors");
  // Legal shapes have no foul, thumb in or out.
  for (const f of [[0, 0, 0, 0], [1, 1, 1, 1], [1, 1, 0, 0]]) {
    assert.equal(foul(f).foul, null);
    assert.equal(foul(f, { thumb: true }).foul, null);
  }
  assert.equal(foul([1, 1, 0, 0], { thumb: true }).gesture, "scissors");
  // An open hand whose pinky reads half-open is still paper, not "3 fingers".
  assert.equal(foul([1, 1, 1, 0], { half: [3] }).gesture, "paper");
});

test("outcome rules", () => {
  assert.equal(outcome("rock", "scissors"), "win");
  assert.equal(outcome("scissors", "paper"), "win");
  assert.equal(outcome("paper", "rock"), "win");
  assert.equal(outcome("rock", "paper"), "lose");
  assert.equal(outcome("paper", "paper"), "draw");
});

test("buffer votes for the majority in a window", () => {
  const b = new GestureBuffer(5000);
  [["rock", 0], ["rock", 100], [null, 150], ["paper", 200], ["rock", 250]].forEach(([g, t]) => b.push(g, t));
  assert.equal(b.vote(0, 300), "rock");
  assert.equal(b.vote(190, 210), "paper");
  assert.equal(b.vote(140, 160), null);
});

test("settled takes the last held gesture, not the countdown fist", () => {
  const b = new GestureBuffer(5000);
  // Fist pumped through the window, scissors formed late and held.
  for (let t = 0; t <= 200; t += 33) b.push("rock", t);
  b.push(null, 233);
  for (let t = 266; t <= 400; t += 33) b.push("scissors", t);
  assert.equal(b.settled(0, 400), "scissors");
  // A one-frame flicker at the end doesn't override a held gesture.
  b.push("paper", 420);
  assert.equal(b.settled(0, 420), "scissors");
  // Held rock stays rock.
  const r = new GestureBuffer(5000);
  for (let t = 0; t <= 400; t += 33) r.push("rock", t);
  assert.equal(r.settled(0, 400), "rock");
  // Only a brief glimpse: fall back to it; nothing at all: null.
  const g = new GestureBuffer(5000);
  g.push(null, 0); g.push("paper", 50); g.push(null, 100);
  assert.equal(g.settled(0, 400), "paper");
  assert.equal(new GestureBuffer().settled(0, 400), null);
});

test("one dropped frame doesn't break a held gesture", () => {
  const b = new GestureBuffer(5000);
  b.push("scissors", 0); b.push(null, 33); b.push("scissors", 66); b.push("scissors", 99);
  assert.equal(b.hasSettled(0, 100, { holdMs: 1000 }), true);
  const c = new GestureBuffer(5000);
  c.push("scissors", 0); c.push(null, 33); c.push(null, 66); c.push("scissors", 99); c.push("scissors", 132);
  assert.equal(c.hasSettled(0, 140, { holdMs: 1000 }), false);
});

test("read reports a held foul when there is no legal gesture", () => {
  const b = new GestureBuffer(5000);
  for (let t = 0; t <= 200; t += 33) b.push(null, t, "three");
  assert.deepEqual(b.read(0, 200), { gesture: null, foul: "three" });
  // A legal gesture in the window beats a foul.
  for (let t = 233; t <= 400; t += 33) b.push("paper", t);
  assert.deepEqual(b.read(0, 400), { gesture: "paper", foul: null });
  // No hand: both null.
  assert.deepEqual(new GestureBuffer().read(0, 400), { gesture: null, foul: null });
});
