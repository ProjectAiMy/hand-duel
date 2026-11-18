import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ScriptRunner, validateScripts } from "../js/world/script.js";
import { freshSave, check } from "../js/save.js";
import { ROSTER, TWISTS } from "../js/npc/roster.js";

function fakeHost({ duels = [], choices = [] } = {}) {
  const log = [];
  return {
    save: freshSave(),
    log,
    say: async (who, lines) => log.push(`say ${who}: ${lines[0]}`),
    choose: async (who) => (log.push(`choose ${who}`), choices.shift() ?? 0),
    duel: async (id) => (log.push(`duel ${id}`), duels.shift()),
    changed: () => {},
    give: function (g) { if (g.stamp) this.save.stamps.push(g.stamp); this.save.coins += g.coins || 0; log.push("give"); },
    spawn: (s) => log.push(`spawn ${s.spawn}`), despawn: (id) => log.push(`despawn ${id}`),
    walk: () => {}, face: () => {}, alert: () => {}, wait: () => {}, fade: () => {},
    warpTo: (w) => log.push(`warp ${w.map}`), run: (id) => stories()[id] || [], creator: async () => log.push("creator"), credits: async () => log.push("credits"),
  };
}

const stories = () => {
  const dir = new URL("../data/story/", import.meta.url);
  return Object.assign({}, ...readdirSync(dir).filter((f) => /^ch\d.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8"))));
};

test("ifs, choices and duel outcomes branch; leaving a duel stops the scene", async () => {
  const h = fakeHost({ duels: [true], choices: [0] });
  await new ScriptRunner(h).run([
    { if: "!seen", then: [{ say: "a", lines: ["first"] }], else: [{ say: "a", lines: ["again"] }] },
    { choose: "a", line: "?", options: ["Duel", "No"], then: [[{ duel: "pip", win: [{ flag: "won" }], lose: [{ flag: "lost" }] }], []] },
    { flag: "seen" },
  ]);
  assert.deepEqual(h.log, ["say a: first", "choose a", "duel pip"]);
  assert.ok(check(h.save, ["seen", "won", "!lost"]));

  const q = fakeHost({ duels: [null] });
  await new ScriptRunner(q).run([{ duel: "pip", win: [{ flag: "won" }] }, { flag: "after" }]);
  assert.ok(!check(q.save, "after"), "quitting the duel ends the scene before the flag");
});

test("skipping hides lines but still asks and still duels", async () => {
  const h = fakeHost({ duels: [false] });
  const r = new ScriptRunner(h);
  r.running = true;
  r.skipping = true;
  await r.steps([{ say: "a", lines: ["hi"] }, { choose: "a", line: "?", options: ["x", "y"], then: [[], []] }, { duel: "pip", lose: [{ flag: "l" }] }]);
  assert.deepEqual(h.log, ["choose a", "duel pip"]);
  assert.ok(h.save.flags.l);
});

test("every story script uses known steps and real opponents", () => {
  const errs = validateScripts(stories(), { rosterIds: ROSTER.map((n) => n.id) });
  assert.deepEqual(errs, []);
});

test("the whole story can be played through to the end (every duel won)", async () => {
  const s = stories();
  const h = fakeHost({ duels: Array(40).fill(true), choices: Array(40).fill(0) });
  const run = (id) => new ScriptRunner(h).run(s[id]);
  // Members are beaten through normal map encounters.
  const beat = (...ids) => ids.forEach((id) => (h.save.record[id] = { w: 1, l: 0 }));
  await run("ch0_intro");
  assert.ok(check(h.save, "ch0_intro") && h.save.chapter === 1);
  await run("gym_intro");
  await run("granite");
  assert.ok(!h.save.stamps.length, "captain waits for the members");
  beat("cobble", "flint");
  await run("granite");
  await run("rio_ch1");
  beat("crane", "inkwell");
  await run("lib_intro");
  await run("fold");
  await run("memo");
  beat("parry", "riposte");
  await run("hall_intro");
  await run("snip");
  await run("rio_ch3");
  beat("mime", "cue");
  await run("aud_intro");
  await run("echo");
  beat("vale", "quill");
  await run("council_intro");
  await run("ren_room");
  assert.ok(h.log.includes("warp festival"));
  await run("fest_intro");
  await run("ren_final");
  assert.deepEqual(h.save.stamps, ["stone", "paper", "blade", "mirror", "final"]);
  assert.ok(check(h.save, ["storyDone", "rio_ch4", "memo"]));
  assert.ok(h.log.includes("credits"));
  assert.equal(h.save.chapter, 6);
  assert.equal(h.save.coins, 700);
});

test("each captain has a known twist and doors in the maps unlock with story flags", () => {
  for (const n of ROSTER.filter((n) => n.twist)) assert.ok(TWISTS[n.twist], n.id);
  const corridor = JSON.parse(readFileSync(new URL("../data/maps/corridor.json", import.meta.url), "utf8"));
  const needs = corridor.doors.filter((d) => d.needs).map((d) => d.needs);
  assert.deepEqual(needs, ["ch0_intro", "stamp:stone", "memo", "rio_ch3", "rio_ch4"]);
});

test("the school implements every host method the story runner calls, and never overwrites one", async () => {
  const { School } = await import("../js/world/school.js");
  const src = readFileSync(new URL("../js/world/school.js", import.meta.url), "utf8");
  const host = ["say", "choose", "duel", "changed", "give", "spawn", "despawn", "walk", "face", "alert", "wait", "fade", "warpTo", "run", "creator", "credits", "scriptEnded"];
  for (const m of host) {
    assert.equal(typeof School.prototype[m], "function", `School.${m}()`);
    assert.ok(!new RegExp(`this\\.${m}\\s*=[^=]`).test(src), `this.${m} is never assigned (it would hide the method)`);
  }
});
