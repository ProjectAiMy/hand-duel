import { test } from "node:test";
import assert from "node:assert/strict";
import { Fight, MAX_HP } from "../js/fight.js";

test("three straight wins is a K.O. via combo damage", () => {
  const f = new Fight();
  assert.equal(f.exchange("rock", "scissors").damage, 25);
  assert.equal(f.exchange("rock", "scissors").damage, 35);
  const ev = f.exchange("paper", "rock");
  assert.equal(ev.damage, 45);
  assert.equal(ev.ko, true);
  assert.equal(ev.perfect, true);
  assert.deepEqual(f.roundWins, [1, 0]);
});

test("a loss or draw breaks the streak", () => {
  const f = new Fight();
  f.exchange("rock", "scissors"); // 25
  f.exchange("rock", "rock"); // draw resets
  assert.equal(f.exchange("rock", "scissors").damage, 25);
  f.exchange("rock", "paper"); // right wins, left streak reset
  assert.equal(f.exchange("rock", "scissors").damage, 25);
});

test("missing throw loses; both missing is void", () => {
  const f = new Fight();
  const ev = f.exchange(null, "paper");
  assert.equal(ev.winner, 1);
  assert.equal(ev.forfeit, true);
  assert.equal(f.exchange(null, null).result, "void");
  assert.equal(f.hp[0], MAX_HP - 25);
});

test("best of 3 rounds ends the match", () => {
  const f = new Fight();
  const ko = () => {
    let ev;
    do ev = f.exchange("scissors", "paper");
    while (!ev.ko);
    return ev;
  };
  assert.equal(ko().matchOver, undefined);
  f.nextRound();
  assert.equal(f.round, 2);
  assert.deepEqual(f.hp, [MAX_HP, MAX_HP]);
  assert.equal(ko().matchOver, true);
  assert.equal(f.matchWinner, 0);
  assert.throws(() => f.exchange("rock", "rock"));
});

test("both sides computing from their own view stay in sync", () => {
  const host = new Fight();
  const guest = new Fight();
  const seq = [["rock", "paper"], ["rock", "rock"], ["scissors", "paper"], [null, "rock"], ["paper", "rock"]];
  for (const [h, g] of seq) {
    host.exchange(h, g);
    guest.exchange(g, h); // mirrored perspective
  }
  assert.deepEqual(host.hp, [...guest.hp].reverse());
});

test("power doubles damage and is used up for the round", () => {
  const f = new Fight();
  const ev = f.exchange("rock", "scissors", ["power", null]);
  assert.equal(ev.damage, 50);
  assert.equal(ev.boosted, true);
  assert.deepEqual(ev.used, ["power", null]);
  assert.equal(f.canUse(0, "power"), false);
  // Already used: ignored on the next throw.
  assert.equal(f.exchange("rock", "scissors", ["power", null]).damage, 35);
  assert.equal(f.hp[1], MAX_HP - 85);
});

test("a power is spent even when the throw is lost or drawn, but not on a void", () => {
  const f = new Fight();
  f.exchange("rock", "rock", ["power", null]);
  assert.equal(f.canUse(0, "power"), false);
  f.exchange(null, null, [null, "shield"]);
  assert.equal(f.canUse(1, "shield"), true);
});

test("shield blocks the hit and resets streaks", () => {
  const f = new Fight();
  f.exchange("rock", "scissors"); // left streak 1
  const ev = f.exchange("rock", "scissors", [null, "shield"]);
  assert.equal(ev.result, "blocked");
  assert.equal(ev.blocked, 35);
  assert.equal(f.hp[1], MAX_HP - 25);
  assert.deepEqual(f.streak, [0, 0]);
});

test("reverse sends the damage back to the winner of the throw", () => {
  const f = new Fight();
  const ev = f.exchange("rock", "scissors", ["power", "reverse"]);
  assert.equal(ev.winner, 0);
  assert.equal(ev.hurt, 0);
  assert.equal(ev.reversed, true);
  assert.equal(ev.damage, 50); // the ×2 bounces back too
  assert.equal(f.hp[0], MAX_HP - 50);
  assert.equal(f.hp[1], MAX_HP);
});

test("a reversed hit can K.O. the attacker, who loses the round", () => {
  const f = new Fight();
  f.hp[0] = 20;
  const ev = f.exchange("paper", "rock", [null, "reverse"]);
  assert.equal(ev.ko, true);
  assert.equal(ev.victor, 1);
  assert.deepEqual(f.roundWins, [0, 1]);
});

test("powers reset each round and survive snapshot/restore mirrored", () => {
  const f = new Fight();
  f.exchange("rock", "scissors", ["shield", "reverse"]);
  const g = new Fight();
  g.restore(f.snapshot(), true);
  assert.equal(g.canUse(0, "reverse"), false); // the guest is the host's right side
  assert.equal(g.canUse(1, "shield"), false);
  assert.equal(g.canUse(1, "power"), true);
  f.hp[1] = 0;
  f.roundWinner = 0;
  f.nextRound();
  assert.equal(f.canUse(0, "shield"), true);
});
