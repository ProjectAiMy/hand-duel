import { test } from "node:test";
import assert from "node:assert/strict";
import { OneEuro, mapPoint, cutoffFor, palmPoint } from "../js/cursor.js";
import { clean, DEFAULTS } from "../js/settings.js";

test("OneEuro holds still input steady and follows a jump", () => {
  const f = new OneEuro(1, 0.007);
  let y = 0;
  for (let i = 0; i < 30; i++) y = f.filter(100 + (i % 2 ? 2 : -2), i / 30); // ±2px jitter
  assert.ok(Math.abs(y - 100) < 1.5, `jitter damped, got ${y}`);
  for (let i = 30; i < 45; i++) y = f.filter(600, i / 30); // big fast move
  assert.ok(y > 550, `catches up within half a second, got ${y}`);
});

test("OneEuro: first sample passes through; reset forgets", () => {
  const f = new OneEuro();
  assert.equal(f.filter(42, 0), 42);
  f.reset();
  assert.equal(f.filter(7, 1), 7);
});

test("mapPoint applies gain around the centre and clamps", () => {
  assert.deepEqual(mapPoint(0.5, 0.5, 2), [0.5, 0.5]);
  assert.deepEqual(mapPoint(0.75, 0.25, 2), [1, 0]);
  assert.deepEqual(mapPoint(0.95, 0.05, 2.5), [1, 0]);
  const [x] = mapPoint(0.6, 0.5, 1.5);
  assert.ok(Math.abs(x - 0.65) < 1e-9);
});

test("smoothing slider maps to a lower cutoff when steadier", () => {
  assert.ok(cutoffFor(0) > cutoffFor(50));
  assert.ok(cutoffFor(50) > cutoffFor(100));
  assert.ok(cutoffFor(100) > 0);
});

test("palmPoint averages wrist and knuckles", () => {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  for (const i of [0, 5, 9, 13, 17]) lm[i] = { x: 0.5, y: 0.2 };
  assert.deepEqual(palmPoint(lm), [0.5, 0.2]);
});

test("settings clean() drops junk, keeps types, clamps ranges", () => {
  const c = clean({ master: 999, muted: "yes", speed: 0, dwell: NaN, bogus: 1, quality: "low" });
  assert.equal(c.master, 100);
  assert.equal(c.muted, DEFAULTS.muted);
  assert.equal(c.speed, 1);
  assert.equal(c.dwell, DEFAULTS.dwell);
  assert.equal(c.quality, "low");
  assert.ok(!("bogus" in c));
});
