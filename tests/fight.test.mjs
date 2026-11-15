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
