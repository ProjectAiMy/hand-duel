import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpponent } from "../js/duel/opponents.js";
import { Fight } from "../js/fight.js";

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("an opponent plans before reading the player and learns only from legal exchanges", () => {
  const opp = createOpponent("ruth", { rng: seeded(2) });
  const fight = new Fight();
  const { gesture } = opp.plan(fight);
  assert.ok(["rock", "paper", "scissors"].includes(gesture));
  opp.record(gesture, null, { result: "hit", winner: 1 }); // player didn't throw: ignored
  assert.equal(opp.hint().total, 0);
  const ev = fight.exchange("rock", gesture);
  opp.record(gesture, "rock", ev);
  const h = opp.hint();
  assert.equal(h.total, 1);
  assert.equal(h.counts[gesture], 1);
  assert.match(h.text, /rock → paper/);
  opp.reset();
  assert.equal(opp.hint().total, 0);
});

test("record keeps the result from the NPC's side", () => {
  const opp = createOpponent("bea", { rng: seeded(3) });
  const f = new Fight();
  const ev = f.exchange("rock", "paper"); // NPC (side 1) wins
  opp.record("paper", "rock", ev);
  assert.equal(opp.hint().recent[0].result, "win");
});

test("unknown ids fall back to the classic CPU, and powers come from what the NPC holds", () => {
  const opp = createOpponent("???", { rng: seeded(1) });
  assert.equal(opp.npc.id, "cpu");
  const tank = createOpponent("tank", { rng: seeded(1) });
  const f = new Fight();
  assert.equal(tank.power(f), "shield"); // always: the only power held at round start
  f.powers[1].shield = false;
  assert.equal(tank.power(f), null);
});
