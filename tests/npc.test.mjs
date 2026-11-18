import { test } from "node:test";
import assert from "node:assert/strict";
import { planThrow, planPower, throwOdds, validateSpec, beats, next } from "../js/npc/strategy.js";
import { ROSTER, byId } from "../js/npc/roster.js";
import { outcome } from "../js/gesture.js";

// Small seeded RNG so tests are repeatable.
function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}
const res = (npc, player) => {
  const o = outcome(npc, player);
  return o === "draw" ? "draw" : o;
};
/** Play `n` throws of an NPC against a player function; returns the NPC's win rate over decisive throws. */
function play(spec, playerFn, n = 400, seed = 7) {
  const rng = seeded(seed);
  const history = [];
  let w = 0, l = 0;
  for (let i = 0; i < n; i++) {
    const { gesture } = planThrow(spec, { history }, { rng });
    const p = playerFn(history, i);
    const r = res(gesture, p);
    if (r === "win") w++;
    if (r === "lose") l++;
    history.push({ npc: gesture, player: p, result: r });
  }
  return w / (w + l);
}

test("helpers: beats and next", () => {
  assert.equal(beats("rock"), "paper");
  assert.equal(beats("scissors"), "rock");
  assert.equal(next("scissors"), "rock");
});

test("every roster spec is valid and has the fields the UI needs", () => {
  const ids = new Set();
  for (const n of ROSTER) {
    assert.deepEqual(validateSpec(n.strategy), [], n.id);
    for (const k of ["id", "group", "name", "title", "trait", "emoji", "intro", "hint"]) assert.ok(n[k], `${n.id}.${k}`);
    assert.ok(n.stars >= 1 && n.stars <= 5, n.id);
    assert.ok(!ids.has(n.id), `duplicate ${n.id}`);
    ids.add(n.id);
  }
  assert.equal(byId("nobody").id, "cpu");
});

test("odds always form a valid distribution", () => {
  const rng = seeded(3);
  for (const n of ROSTER) {
    const history = [];
    for (let i = 0; i < 30; i++) {
      const d = throwOdds(n.strategy, { history, npcHp: 40, playerHp: 80 });
      assert.equal(d.length, 3);
      assert.ok(d.every((v) => Number.isFinite(v) && v >= 0), n.id);
      assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 1) < 1e-9, n.id);
      const g = ["rock", "paper", "scissors"][Math.floor(rng() * 3)];
      history.push({ npc: g, player: g, result: "draw" });
    }
  }
});

test("Pip opens each round with rock", () => {
  const spec = { ...byId("pip").strategy, noise: 0 };
  for (let s = 1; s < 30; s++) assert.equal(planThrow(spec, { history: [] }, { rng: seeded(s) }).gesture, "rock");
  const mid = [{ npc: "paper", player: "rock", result: "win" }];
  assert.equal(planThrow(spec, { history: mid, roundStart: true }, { rng: seeded(2) }).gesture, "rock");
});

test("Ms. Ruth cycles rock → paper → scissors", () => {
  const spec = { ...byId("ruth").strategy, noise: 0, behaviours: [{ type: "cycle", w: 1 }] };
  const history = [{ npc: "rock", player: "rock", result: "draw" }];
  assert.equal(planThrow(spec, { history }, { rng: seeded(1) }).gesture, "paper");
  history.push({ npc: "paper", player: "rock", result: "win" });
  assert.equal(planThrow(spec, { history }, { rng: seeded(1) }).gesture, "scissors");
});

test("Fold never repeats a throw", () => {
  const spec = byId("fold").strategy;
  const rng = seeded(11);
  const history = [];
  for (let i = 0; i < 300; i++) {
    const { gesture } = planThrow(spec, { history }, { rng });
    if (history.length) assert.notEqual(gesture, history[history.length - 1].npc);
    history.push({ npc: gesture, player: "rock", result: res(gesture, "rock") });
  }
});

test("Echo copies, then counters the copy at low health", () => {
  const spec = { ...byId("echo").strategy, noise: 0 };
  spec.behaviours = [{ type: "copy", w: 1 }];
  spec.mood = [{ when: "lowHp", replace: [{ type: "counterCounter", w: 1 }] }];
  const history = [{ npc: "rock", player: "scissors", result: "win" }];
  assert.equal(planThrow(spec, { history, npcHp: 100 }, { rng: seeded(1) }).gesture, "scissors");
  // You'd beat a copied scissors with rock; Echo beats that with paper.
  assert.equal(planThrow(spec, { history, npcHp: 40 }, { rng: seeded(1) }).gesture, "paper");
});

test("Snip counters your last throw only after losing", () => {
  const spec = { behaviours: [{ type: "counterLast", when: "afterLoss", w: 1 }], noise: 0, bias: { rock: 1 } };
  const lost = [{ npc: "rock", player: "paper", result: "lose" }];
  assert.equal(planThrow(spec, { history: lost }, { rng: seeded(1) }).gesture, "scissors");
  const won = [{ npc: "rock", player: "scissors", result: "win" }];
  assert.equal(planThrow(spec, { history: won }, { rng: seeded(1) }).gesture, "rock");
});

test("Bea repeats a win and panics into paper after a loss", () => {
  const spec = { behaviours: [{ type: "winStay", w: 1 }, { type: "fixed", g: "paper", when: "afterLoss", w: 1 }], noise: 0 };
  assert.equal(planThrow(spec, { history: [{ npc: "scissors", player: "paper", result: "win" }] }, { rng: seeded(1) }).gesture, "scissors");
  assert.equal(planThrow(spec, { history: [{ npc: "rock", player: "paper", result: "lose" }] }, { rng: seeded(1) }).gesture, "paper");
});

test("Granite gets more stubborn when ahead", () => {
  const spec = byId("granite").strategy;
  const even = throwOdds(spec, { history: [], npcHp: 100, playerHp: 100 });
  const ahead = throwOdds(spec, { history: [], npcHp: 100, playerHp: 50 });
  assert.ok(ahead[0] > even[0]);
});

test("Ren beats a player who repeats a pattern", () => {
  const pattern = ["rock", "rock", "paper", "scissors"];
  const rate = play(byId("ren").strategy, (h, i) => pattern[i % 4]);
  assert.ok(rate > 0.7, `Ren win rate ${rate}`);
});

test("Dex beats a player with a favourite throw", () => {
  const rate = play(byId("dex").strategy, (h, i) => (i % 5 === 0 ? "paper" : "rock"));
  assert.ok(rate > 0.65, `Dex win rate ${rate}`);
});

test("random opponents can't be exploited by a fixed throw", () => {
  for (const id of ["cpu", "luna"]) {
    const rate = play(byId(id).strategy, () => "rock", 2000);
    assert.ok(rate > 0.4 && rate < 0.6, `${id} ${rate}`);
  }
});

test("Rio uses memory from earlier matches", () => {
  const spec = { ...byId("rio").strategy, noise: 0 };
  const memory = Array(50).fill("scissors");
  const d = throwOdds(spec, { history: [], memory });
  assert.ok(d[0] > 0.6, "expects rock against a scissors habit");
  const without = throwOdds({ ...spec, useMemory: false }, { history: [], memory });
  assert.ok(Math.abs(without[0] - 1 / 3) < 1e-9);
});

test("lower noise (Easy) makes a habit easier to see", () => {
  const spec = byId("granite").strategy;
  const normal = throwOdds(spec, { history: [] });
  const easy = throwOdds(spec, { history: [] }, { noiseScale: 0.5 });
  assert.ok(easy[0] > normal[0]);
});

test("tells follow the planned throw", () => {
  const spec = { bias: { rock: 1 }, noise: 0, tell: { before: "rock", text: "knuckles", chance: 1, falseChance: 0 } };
  assert.equal(planThrow(spec, {}, { rng: seeded(4) }).tell, "knuckles");
  const p = planThrow({ ...spec, bias: { paper: 1 } }, {}, { rng: seeded(4) });
  assert.equal(p.gesture, "paper");
  assert.equal(p.tell, null);
});

test("power policies", () => {
  const rng = seeded(5);
  assert.equal(planPower({ powers: "never" }, { held: ["shield"] }, { rng }), null);
  assert.equal(planPower({ powers: "always" }, { held: ["shield", "power"] }, { rng }), "power");
  assert.equal(planPower({ powers: "always" }, { held: [] }, { rng }), null);
  assert.equal(planPower({ powers: "whenBehind" }, { held: ["shield"], npcHp: 100, playerHp: 50 }, { rng }), null);
  let used = 0;
  for (let i = 0; i < 100; i++) if (planPower({ powers: "whenBehind" }, { held: ["shield", "reverse"], npcHp: 20, playerHp: 90 }, { rng })) used++;
  assert.ok(used > 40 && used < 80, `used ${used}`);
});

test("validateSpec reports mistakes", () => {
  assert.ok(validateSpec({ behaviours: [{ type: "telepathy" }] }).length);
  assert.ok(validateSpec({ behaviours: [{ type: "opener" }] }).length);
  assert.ok(validateSpec({ mood: [{ when: "sometimes" }] }).length);
  assert.ok(validateSpec({ bias: { lizard: 1 } }).length);
});
