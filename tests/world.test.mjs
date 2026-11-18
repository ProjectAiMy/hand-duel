import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseMap, isSolid, isBlocked, sightLine, spots, findPath, dirToward, step, doorAt } from "../js/world/grid.js";
import { freshSave, migrate, loadSave, writeSave, recordDuel, beaten, exportCode, importCode, SAVE_KEY } from "../js/save.js";
import { ROSTER } from "../js/npc/roster.js";

const small = () =>
  parseMap({
    id: "t",
    tiles: ["#####", "#...#", "#.#.#", "#...#", "##D##"],
    doors: [{ x: 2, y: 4, to: "elsewhere", tx: 1, ty: 1 }],
  });

test("parseMap checks row widths, tiles and placements", () => {
  assert.throws(() => parseMap({ id: "x", tiles: ["...", ".."] }), /row 1/);
  assert.throws(() => parseMap({ id: "x", tiles: ["..?"] }), /unknown tile/);
  assert.throws(() => parseMap({ id: "x", tiles: ["..."], npcs: [{ id: "a", x: 5, y: 0 }] }), /off the map/);
  const m = small();
  assert.equal(m.w, 5);
  assert.equal(m.h, 5);
});

test("solid tiles, the map edge, things and dead-end doors block; doors that lead somewhere don't", () => {
  const m = small();
  assert.ok(isSolid(m, 0, 0));
  assert.ok(isSolid(m, 2, 2));
  assert.ok(isSolid(m, -1, 1));
  assert.ok(!isSolid(m, 1, 1));
  assert.ok(!isSolid(m, 2, 4), "door with a destination");
  const dead = parseMap({ id: "d", tiles: ["D.."], doors: [{ x: 0, y: 0, lines: ["Locked"] }], things: [{ x: 2, y: 0, kind: "x" }] });
  assert.ok(isSolid(dead, 0, 0), "locked door");
  assert.ok(isSolid(dead, 2, 0), "thing");
  assert.ok(isBlocked(m, 1, 1, [{ x: 1, y: 1 }]));
  assert.equal(doorAt(m, 2, 4).to, "elsewhere");
});

test("sight runs straight ahead and stops at walls and other people", () => {
  const m = parseMap({ id: "s", tiles: [".......", "...#..."] });
  const npc = { x: 0, y: 0, face: "right" };
  assert.deepEqual(sightLine(m, npc, 3), [[1, 0], [2, 0], [3, 0]]);
  assert.equal(spots(m, npc, { x: 3, y: 0 }, 3), 3);
  assert.equal(spots(m, npc, { x: 4, y: 0 }, 3), 0, "out of range");
  assert.equal(spots(m, npc, { x: 3, y: 0 }, 5, [{ x: 2, y: 0 }]), 0, "someone in the way");
  assert.equal(spots(m, { x: 3, y: 0, face: "down" }, { x: 3, y: 1 }, 3), 0, "wall");
  assert.equal(spots(m, { x: 0, y: 0, face: "left" }, { x: 1, y: 0 }, 3), 0, "looking the other way");
});

test("findPath walks around walls and can stop next to a target", () => {
  const m = small();
  const free = (x, y) => isSolid(m, x, y);
  const path = findPath(m, { x: 1, y: 1 }, { x: 3, y: 3 }, free);
  assert.equal(path.length, 4);
  let at = [1, 1];
  for (const d of path) {
    at = step(...at, d);
    assert.ok(!isSolid(m, ...at));
  }
  assert.deepEqual(at, [3, 3]);
  const next = findPath(m, { x: 1, y: 1 }, { x: 3, y: 1 }, free, { adjacent: true });
  assert.deepEqual(next, ["right"]);
  assert.equal(findPath(m, { x: 1, y: 1 }, { x: 2, y: 2 }, free), null, "a wall is never reached");
  assert.deepEqual(findPath(m, { x: 1, y: 1 }, { x: 1, y: 1 }, free), []);
});

test("dirToward", () => {
  assert.equal(dirToward({ x: 0, y: 0 }, { x: 3, y: 0 }), "right");
  assert.equal(dirToward({ x: 0, y: 5 }, { x: 0, y: 1 }), "up");
  assert.equal(dirToward({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
});

test("every school map loads, its doors lead to real tiles, and its NPCs are in the roster", () => {
  const dir = new URL("../data/maps/", import.meta.url);
  const maps = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const m = parseMap(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
        return [m.id, m];
      }),
  );
  assert.ok(maps.courtyard && maps.corridor);
  for (const m of Object.values(maps)) {
    assert.ok(!isSolid(m, m.spawn.x, m.spawn.y), `${m.id} spawn is free`);
    for (const d of m.doors.filter((d) => d.to)) {
      const to = maps[d.to];
      assert.ok(to, `${m.id} door leads to ${d.to}`);
      assert.ok(!isSolid(to, d.tx, d.ty), `${m.id} → ${d.to} lands on a free tile`);
    }
    const ids = new Set(ROSTER.map((n) => n.id));
    for (const n of m.npcs) {
      assert.ok(!isSolid(m, n.x, n.y), `${n.id} stands on a free tile`);
      if (n.as) assert.ok(ids.has(n.as), `${n.id} borrows a roster look`);
      else if (!n.talk && !n.name) assert.ok(ids.has(n.id), `${n.id} is in the roster`);
      // Everyone the player must be able to reach can be walked up to from the spawn.
      const others = m.npcs.filter((o) => o !== n);
      const p = findPath(m, m.spawn, n, (x, y) => isBlocked(m, x, y, others), { adjacent: true });
      assert.ok(p, `${m.id}: ${n.id} can be reached`);
    }
  }
});

test("every roster entry has after-duel lines", () => {
  for (const n of ROSTER) assert.ok(n.lines?.beaten && n.lines?.won, n.id);
});

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
};

test("saves round-trip through storage and drop bad fields", () => {
  const st = memStore();
  assert.deepEqual(loadSave(st).record, {});
  const s = freshSave();
  s.map = "corridor";
  s.x = 4;
  s.y = 2;
  s.face = "left";
  recordDuel(s, "pip", true);
  recordDuel(s, "pip", false);
  recordDuel(s, "bea", false);
  s.flags.metHale = true;
  writeSave(s, st);
  const back = loadSave(st);
  assert.deepEqual(back.record, { pip: { w: 1, l: 1 }, bea: { w: 0, l: 1 } });
  assert.ok(beaten(back, "pip") && !beaten(back, "bea"));
  assert.equal(back.map, "corridor");
  assert.equal(back.face, "left");
  assert.equal(back.flags.metHale, true);

  st.setItem(SAVE_KEY, "{not json");
  assert.equal(loadSave(st).map, null);
  const odd = migrate({ v: 1, map: "../x", x: -2, y: 3, face: "north", record: { pip: { w: "9" }, "bad id!": { w: 1 } }, flags: { a: "yes" } });
  assert.equal(odd.map, null);
  assert.equal(odd.x, null);
  assert.equal(odd.face, "down");
  assert.deepEqual(odd.record, { pip: { w: 0, l: 0 } });
  assert.deepEqual(odd.flags, {});
  assert.equal(migrate({ v: 99 }).map, null, "a save from a newer version starts fresh");
});

test("save codes round-trip and reject junk", () => {
  const s = freshSave();
  s.map = "courtyard";
  s.x = 9;
  s.y = 12;
  recordDuel(s, "dex", true);
  const code = exportCode(s);
  assert.match(code, /^HD1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(importCode(` ${code.slice(0, 20)}\n${code.slice(20)} `).record, { dex: { w: 1, l: 0 } });
  assert.throws(() => importCode("hello"), /isn't a Hand Duel save code/);
  assert.throws(() => importCode("HD1.@@@"), /damaged/);
  assert.throws(() => importCode("HD1." + btoa(JSON.stringify({ v: 5 }))), /newer version/);
});

test("the goal counter lists exactly the challengers placed on the school maps", async () => {
  const { SCHOOL_CHALLENGERS } = await import("../js/world/school.js");
  // school.js touches the DOM only when constructed, so importing it in node is fine.
  const dir = new URL("../data/maps/", import.meta.url);
  const placed = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")).npcs.filter((n) => !n.talk && !n.script && !n.as && !n.name && n.sight !== 0).map((n) => n.id));
  assert.deepEqual([...SCHOOL_CHALLENGERS].sort(), placed.sort());
});

test("story conditions and the extended save fields", async () => {
  const { check, STAMPS } = await import("../js/save.js");
  const s = freshSave();
  s.flags.metRio = true;
  recordDuel(s, "granite", true);
  s.stamps.push("stone");
  s.chapter = 2;
  assert.ok(check(s, "metRio") && !check(s, "!metRio"));
  assert.ok(check(s, ["beat:granite", "!beat:fold", "stamp:stone", "chapter>=2"]));
  assert.ok(!check(s, "chapter>=3") && !check(s, "stamp:paper"));
  assert.ok(check(s, undefined) && check(s, []));
  const back = migrate({ ...s, coins: 50, items: ["extra:glasses", "bad item", "extra:glasses"], stamps: ["final", "nope", "stone"], name: "Ash<script>", avatar: { hair: "spiky" } });
  assert.deepEqual(back.stamps, ["stone", "final"]);
  assert.deepEqual(back.items, ["extra:glasses"]);
  assert.equal(back.coins, 50);
  assert.equal(back.name, "Ashscript");
  assert.equal(back.avatar.hair, "spiky");
  assert.equal(STAMPS.length, 5);
});

test("save codes keep non-English names", () => {
  const s = freshSave();
  s.name = "Zoë 明";
  assert.equal(importCode(exportCode(s)).name, "Zoë 明");
});
