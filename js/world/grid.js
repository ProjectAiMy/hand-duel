// School map logic: pure functions, no DOM, so it's unit-tested like gesture.js.
// A map is JSON (data/maps/*.json): rows of tile characters, plus doors, NPCs and things placed by x, y.
// Tiled support can come later: it would only need to build the same object.

export const TILE = 16; // logical pixels per tile (the art pack may change this later)

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const DIR_KEYS = Object.keys(DIRS);

/** Tile characters. `solid` tiles block walking and sight. */
export const TILES = {
  ".": { name: "floor" },
  ",": { name: "grass" },
  "=": { name: "path" },
  f: { name: "flowers" },
  m: { name: "mat" },
  "#": { name: "wall", solid: true },
  w: { name: "window", solid: true },
  T: { name: "tree", solid: true },
  "~": { name: "water", solid: true },
  B: { name: "bench", solid: true },
  L: { name: "lockers", solid: true },
  G: { name: "gate", solid: true },
  N: { name: "notice", solid: true },
  V: { name: "vending", solid: true },
  d: { name: "desk", solid: true },
  h: { name: "hedge", solid: true },
  D: { name: "door" }, // walkable only when it leads somewhere (see isSolid)
};

/** Build a map object from its JSON. Throws on rows of different lengths or unknown tiles. */
export function parseMap(json) {
  const rows = json.tiles;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`map ${json.id}: no tiles`);
  const w = rows[0].length;
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`map ${json.id}: row ${y} is ${r.length} wide, expected ${w}`);
    for (const ch of r) if (!TILES[ch]) throw new Error(`map ${json.id}: unknown tile "${ch}" in row ${y}`);
  });
  const map = {
    id: json.id,
    name: json.name || json.id,
    music: json.music || "school",
    ground: json.ground || ",",
    w,
    h: rows.length,
    rows,
    spawn: json.spawn || { x: 1, y: 1, face: "down" },
    doors: json.doors || [],
    npcs: json.npcs || [],
    things: json.things || [],
  };
  for (const list of [map.doors, map.npcs, map.things])
    for (const o of list) if (!inBounds(map, o.x, o.y)) throw new Error(`map ${json.id}: ${o.id || o.to || o.kind} at ${o.x},${o.y} is off the map`);
  return map;
}

export const inBounds = (map, x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h;
export const tileAt = (map, x, y) => (inBounds(map, x, y) ? map.rows[y][x] : "#");
export const doorAt = (map, x, y) => map.doors.find((d) => d.x === x && d.y === y) || null;
export const thingAt = (map, x, y) => map.things.find((t) => t.x === x && t.y === y) || null;

/** A tile you can't stand on: walls, furniture, things, and doors that don't lead anywhere (yet). */
export function isSolid(map, x, y) {
  if (!inBounds(map, x, y)) return true;
  const ch = tileAt(map, x, y);
  if (ch === "D") return !doorAt(map, x, y)?.to;
  if (TILES[ch].solid) return true;
  return !!thingAt(map, x, y);
}

/** Solid, or someone is standing there. `actors` = [{ x, y }]. */
export const isBlocked = (map, x, y, actors = []) => isSolid(map, x, y) || actors.some((a) => a.x === x && a.y === y);

export const step = (x, y, dir) => [x + DIRS[dir][0], y + DIRS[dir][1]];

/** The direction from a to b when they're in a straight line (or the larger axis), else null when equal. */
export function dirToward(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export const opposite = (dir) => ({ up: "down", down: "up", left: "right", right: "left" })[dir];

/**
 * Tiles a watcher can see: straight ahead in the way they face, up to `range` tiles, stopping at the
 * first solid tile or other actor (`others` blocks the view; don't include the player in it).
 */
export function sightLine(map, watcher, range, others = []) {
  const out = [];
  let [x, y] = [watcher.x, watcher.y];
  for (let i = 0; i < range; i++) {
    [x, y] = step(x, y, watcher.face);
    if (isSolid(map, x, y) || others.some((a) => a !== watcher && a.x === x && a.y === y)) break;
    out.push([x, y]);
  }
  return out;
}

/** How many tiles away the watcher sees the player, or 0 if they don't. */
export function spots(map, watcher, player, range, others = []) {
  const line = sightLine(map, watcher, range, others);
  const i = line.findIndex(([x, y]) => x === player.x && y === player.y);
  return i + 1;
}

/**
 * Shortest walk from `from` to `to` (breadth-first on the grid). Returns a list of directions, or null.
 * `blocked(x, y)` says which tiles can't be entered. With `adjacent`, the walk ends next to `to`
 * (for walking up to a person or a thing), and `to` itself may be blocked.
 */
export function findPath(map, from, to, blocked, { adjacent = false, maxNodes = 4000 } = {}) {
  const key = (x, y) => y * map.w + x;
  const goal = (x, y) => (adjacent ? Math.abs(x - to.x) + Math.abs(y - to.y) === 1 : x === to.x && y === to.y);
  if (goal(from.x, from.y)) return [];
  const prev = new Map([[key(from.x, from.y), null]]);
  const queue = [[from.x, from.y]];
  while (queue.length && prev.size < maxNodes) {
    const [cx, cy] = queue.shift();
    for (const d of DIR_KEYS) {
      const [nx, ny] = step(cx, cy, d);
      const k = key(nx, ny);
      if (prev.has(k) || !inBounds(map, nx, ny) || blocked(nx, ny)) continue;
      prev.set(k, [key(cx, cy), d]);
      if (goal(nx, ny)) {
        const path = [];
        for (let at = k; prev.get(at); at = prev.get(at)[0]) path.unshift(prev.get(at)[1]);
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}
