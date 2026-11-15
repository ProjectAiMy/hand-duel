// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, outcome, GestureBuffer } from "../js/gesture.js";

// Build a synthetic 21-point hand (cm units). fingers: [index, middle, ring, pinky] straight?
// rot rotates the whole hand in the image plane to check rotation invariance.
function hand([i, m, r, p], rot = 0) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  // thumb (ignored by classifier)
  [1, 2, 3, 4].forEach((k, n) => (pts[k] = { x: -3 - n, y: 2 + n * 1.5, z: 0 }));
  const xs = [-2, 0, 2, 3.8];
  const straight = [i, m, r, p];
  [5, 9, 13, 17].forEach((mcp, f) => {
    const x = xs[f];
    pts[mcp] = { x, y: 8, z: 0 };
    pts[mcp + 1] = { x, y: 12, z: 0 }; // pip
    if (straight[f]) {
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
