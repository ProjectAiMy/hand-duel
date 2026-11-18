// Placeholder school art, drawn in code at 16 px per tile and scaled up with crisp pixels.
// M3 swaps characters for layered avatars from an art pack, and M7 replaces all of it with your designs,
// so nothing here is meant to last: it only has to read clearly on a phone.
import { TILE, tileAt, doorAt } from "./grid.js";

/** Same random number for the same tile every time, so speckles don't flicker. */
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const C = {
  grass: "#5fa85a", grassDark: "#4c9148", grassLight: "#76bf6c",
  path: "#d9c49b", pathDark: "#c2ab80",
  floor: "#cdb98f", floor2: "#c3ae83", floorLine: "#b49f74",
  wall: "#555c80", wallDark: "#40466a", wallTop: "#6a729a",
  glass: "#9fd8ff", glassHi: "#e3f5ff",
  trunk: "#6b4a2b", leaf: "#2f7d3a", leafHi: "#43a04f",
  water: "#5b8fd9", waterHi: "#a8cbff", stone: "#b9b2a3",
  wood: "#8a5a33", woodDark: "#5e3b1f",
  locker: "#5b7db3", lockerDark: "#46679a", metal: "#d0d6e6",
  hedge: "#2f6e35", hedgeHi: "#3f8b46",
};

function px(g, color, x, y, w = 1, h = 1) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function ground(g, ch, tx, ty, x, y) {
  if (ch === "," || ch === "f") {
    px(g, C.grass, x, y, TILE, TILE);
    for (let i = 0; i < 4; i++) {
      const bx = Math.floor(hash(tx, ty, i) * 14) + 1;
      const by = Math.floor(hash(tx, ty, i + 9) * 13) + 1;
      px(g, i === 3 ? C.grassLight : C.grassDark, x + bx, y + by, 1, 2);
    }
    if (ch === "f")
      ["#ff6b8b", "#ffd23f", "#ffffff", "#ff6b8b"].forEach((c, i) => {
        const fx = x + 2 + Math.floor(hash(tx, ty, 20 + i) * 11);
        const fy = y + 2 + Math.floor(hash(tx, ty, 30 + i) * 11);
        px(g, c, fx, fy, 2, 2);
        px(g, "#ffe9a8", fx, fy, 1, 1);
      });
  } else if (ch === "=") {
    px(g, C.path, x, y, TILE, TILE);
    for (let i = 0; i < 3; i++) px(g, C.pathDark, x + Math.floor(hash(tx, ty, i) * 14) + 1, y + Math.floor(hash(tx, ty, i + 5) * 14) + 1, 2, 1);
  } else {
    px(g, (tx + ty) % 2 ? C.floor : C.floor2, x, y, TILE, TILE);
    px(g, C.floorLine, x, y + TILE - 1, TILE, 1);
  }
}

function wall(g, x, y, openBelow) {
  px(g, C.wall, x, y, TILE, TILE);
  for (let r = 0; r < 4; r++) {
    px(g, C.wallDark, x, y + r * 4 + 3, TILE, 1);
    px(g, C.wallDark, x + (r % 2 ? 4 : 11), y + r * 4, 1, 3);
  }
  if (openBelow) px(g, "#00000033", x, y + TILE - 2, TILE, 2);
}

/** One tile at map position (tx, ty). `base` is the ground under furniture (grass outside, floor inside). */
function drawTile(g, map, tx, ty, base) {
  const ch = tileAt(map, tx, ty);
  const x = tx * TILE;
  const y = ty * TILE;
  const below = tileAt(map, tx, ty + 1);
  const wallish = (c) => c === "#" || c === "w" || c === "L" || c === "D" || c === "S" || c === "C";
  switch (ch) {
    case ",": case "=": case "f": case ".":
      return ground(g, ch, tx, ty, x, y);
    case "y":
      px(g, "#7fae6a", x, y, TILE, TILE);
      px(g, "#8dbb77", x, y, TILE, 1);
      if (tx % 8 === 0) px(g, "#f5f5f4", x + 7, y, 2, TILE);
      if (ty % 6 === 0) px(g, "#f5f5f4", x, y + 7, TILE, 2);
      return;
    case "P":
      px(g, "#b07a45", x, y, TILE, TILE);
      px(g, "#8d5f33", x, y + 7, TILE, 1);
      px(g, "#8d5f33", x, y + 15, TILE, 1);
      px(g, "#c99060", x + (ty % 2 ? 3 : 11), y + 1, 1, 6);
      return;
    case "S": {
      px(g, C.woodDark, x, y, TILE, TILE);
      const books = ["#b91c1c", "#1d4ed8", "#ca8a04", "#15803d", "#7c3aed", "#e5e7eb"];
      for (const sy of [1, 8])
        for (let i = 0; i < 7; i++) px(g, books[Math.floor(hash(tx, ty, sy * 10 + i) * books.length)], x + 1 + i * 2, y + sy + (i % 3 === 0 ? 1 : 0), 2, 6 - (i % 3 === 0 ? 1 : 0));
      px(g, C.wood, x, y + 7, TILE, 1);
      px(g, C.wood, x, y + 15, TILE, 1);
      return;
    }
    case "C":
      px(g, "#8b1e2d", x, y, TILE, TILE);
      for (let i = 0; i < 4; i++) px(g, "#6d1622", x + i * 4 + 1, y, 1, TILE);
      px(g, "#ffcc33", x, y + TILE - 2, TILE, 1);
      return;
    case "k":
      ground(g, ".", tx, ty, x, y);
      px(g, "#7f1d1d", x + 1, y + 2, 14, 10);
      px(g, "#b91c1c", x + 2, y + 3, 5, 6);
      px(g, "#b91c1c", x + 9, y + 3, 5, 6);
      px(g, "#00000040", x + 1, y + 12, 14, 2);
      return;
    case "m":
      ground(g, ".", tx, ty, x, y);
      px(g, "#7b3f5c", x, y + 2, TILE, 12);
      px(g, "#a65b7f", x, y + 3, TILE, 1);
      px(g, "#a65b7f", x, y + 12, TILE, 1);
      return;
    case "#":
      return wall(g, x, y, !wallish(below));
    case "w":
      wall(g, x, y, !wallish(below));
      px(g, C.wallTop, x + 2, y + 2, 12, 11);
      px(g, C.glass, x + 3, y + 3, 10, 9);
      px(g, C.glassHi, x + 4, y + 4, 2, 4);
      px(g, C.wallTop, x + 7, y + 3, 1, 9);
      return;
    case "L":
      px(g, C.locker, x, y, TILE, TILE);
      px(g, C.lockerDark, x + 7, y, 2, TILE);
      px(g, C.lockerDark, x, y + TILE - 2, TILE, 2);
      for (const lx of [2, 11]) {
        px(g, C.lockerDark, x + lx, y + 3, 3, 1);
        px(g, C.lockerDark, x + lx, y + 5, 3, 1);
        px(g, C.metal, x + (lx === 2 ? 5 : 10), y + 8, 1, 2);
      }
      return;
    case "D": {
      const d = doorAt(map, tx, ty);
      const open = !!d?.to && !d.locked;
      wall(g, x, y, false);
      px(g, C.woodDark, x + 1, y, 14, TILE);
      px(g, open ? "#3a2614" : C.wood, x + 2, y + 1, 12, TILE - 1);
      if (open) {
        px(g, "#ffd76a55", x + 2, y + 1, 12, TILE - 1);
        px(g, "#f6e7b0", x + 3, y + TILE - 3, 10, 3); // light spilling out: you can go through
      } else {
        px(g, C.woodDark, x + 7, y + 1, 2, TILE - 1);
        px(g, "#f0c060", x + 5, y + 8, 1, 2);
        px(g, "#f0c060", x + 10, y + 8, 1, 2);
      }
      return;
    }
    case "T":
      ground(g, base, tx, ty, x, y);
      px(g, "#00000033", x + 2, y + 12, 12, 3);
      px(g, C.trunk, x + 6, y + 9, 4, 6);
      px(g, C.leaf, x + 1, y + 1, 14, 9);
      px(g, C.leaf, x + 3, y - 1, 10, 2);
      px(g, C.leaf, x + 2, y + 10, 12, 1);
      px(g, C.leafHi, x + 4, y + 2, 4, 3);
      px(g, C.leafHi, x + 10, y + 5, 2, 2);
      return;
    case "~": {
      px(g, C.water, x, y, TILE, TILE);
      const w = (c) => c === "~";
      if (!w(tileAt(map, tx, ty - 1))) px(g, C.stone, x, y, TILE, 3);
      if (!w(below)) px(g, C.stone, x, y + TILE - 3, TILE, 3);
      if (!w(tileAt(map, tx - 1, ty))) px(g, C.stone, x, y, 3, TILE);
      if (!w(tileAt(map, tx + 1, ty))) px(g, C.stone, x + TILE - 3, y, 3, TILE);
      px(g, C.waterHi, x + 4 + Math.floor(hash(tx, ty) * 6), y + 6, 4, 1);
      px(g, C.waterHi, x + 3 + Math.floor(hash(tx, ty, 2) * 6), y + 10, 3, 1);
      return;
    }
    case "B":
      ground(g, base, tx, ty, x, y);
      px(g, "#00000033", x + 1, y + 11, 14, 3);
      px(g, C.wood, x, y + 5, TILE, 3);
      px(g, C.wood, x, y + 9, TILE, 2);
      px(g, C.woodDark, x + 2, y + 11, 2, 3);
      px(g, C.woodDark, x + 12, y + 11, 2, 3);
      return;
    case "G":
      ground(g, "=", tx, ty, x, y);
      px(g, "#2f3140", x, y + 2, TILE, 2);
      for (let i = 1; i < TILE; i += 3) px(g, "#3b3d4e", x + i, y + 2, 1, 13);
      return;
    case "N":
      ground(g, base, tx, ty, x, y);
      px(g, C.woodDark, x + 3, y + 12, 2, 4);
      px(g, C.woodDark, x + 11, y + 12, 2, 4);
      px(g, C.wood, x, y + 1, TILE, 12);
      px(g, "#c99a5b", x + 1, y + 2, 14, 10);
      px(g, "#ffffff", x + 2, y + 3, 4, 5);
      px(g, "#fff3a8", x + 7, y + 4, 5, 4);
      px(g, "#ff8fa3", x + 10, y + 8, 4, 3);
      px(g, "#e5484d", x + 3, y + 3, 1, 1);
      return;
    case "V":
      ground(g, base, tx, ty, x, y);
      px(g, "#a3243a", x + 1, y, 14, TILE);
      px(g, "#c62f45", x + 2, y + 1, 12, 14);
      px(g, "#cfe8ff", x + 3, y + 2, 7, 8);
      ["#ffd23f", "#3fe0ff", "#7cf29a"].forEach((c, i) => px(g, c, x + 4 + i * 2, y + 4, 1, 4));
      px(g, "#222", x + 11, y + 4, 2, 4);
      px(g, "#222", x + 3, y + 12, 7, 2);
      return;
    case "d":
      ground(g, ".", tx, ty, x, y);
      px(g, "#7a5530", x + 1, y + 4, 14, 8);
      px(g, "#a0703f", x + 1, y + 3, 14, 7);
      return;
    case "h":
      ground(g, ",", tx, ty, x, y);
      px(g, C.hedge, x, y + 1, TILE, 14);
      for (let i = 0; i < 4; i++) px(g, C.hedgeHi, x + i * 4 + 1, y + 2 + (i % 2) * 5, 3, 3);
      return;
    default:
      return ground(g, ".", tx, ty, x, y);
  }
}

/** The whole map's tiles drawn once into a canvas at 1 logical pixel per pixel. */
export function bakeMap(map) {
  const c = document.createElement("canvas");
  c.width = map.w * TILE;
  c.height = map.h * TILE;
  const g = c.getContext("2d");
  const base = map.ground || ",";
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) drawTile(g, map, tx, ty, base);
  return c;
}

/**
 * A chibi placeholder: big head, small body, about 16×20 px, feet on the tile's bottom edge.
 * `look` = { skin, hair, top }. `walk` is 0 or 1 for the stepping frame.
 */
export function drawActor(g, x, y, face, look, walk = 0) {
  x = Math.round(x);
  y = Math.round(y) - 4;
  const { skin = "#f0c8a0", hair = "#2a2236", top = "#3fb6ff" } = look || {};
  const bob = walk ? 1 : 0;
  px(g, "#00000040", x + 3, y + 18, 10, 2);
  // legs
  const legL = face === "left" || face === "right" ? (walk ? 1 : 0) : walk ? -1 : 0;
  px(g, "#2b2b3a", x + 5, y + 15 + Math.max(0, legL), 2, 3 - Math.max(0, legL));
  px(g, "#2b2b3a", x + 9, y + 15 + Math.max(0, -legL), 2, 3 - Math.max(0, -legL));
  // body and arms
  px(g, top, x + 4, y + 10 - bob, 8, 6);
  px(g, "#00000030", x + 4, y + 14 - bob, 8, 1);
  if (face !== "left") px(g, skin, x + 12, y + 11 - bob, 1, 3);
  if (face !== "right") px(g, skin, x + 3, y + 11 - bob, 1, 3);
  // head
  const hy = y - bob;
  px(g, skin, x + 2, hy + 1, 12, 10);
  px(g, skin, x + 3, hy, 10, 1);
  px(g, hair, x + 2, hy - 1, 12, 4);
  px(g, hair, x + 3, hy - 2, 10, 1);
  if (face === "up") px(g, hair, x + 2, hy + 3, 12, 7);
  else if (face === "left") {
    px(g, hair, x + 10, hy + 3, 4, 6);
    px(g, "#1b1b24", x + 4, hy + 6, 1, 2);
    px(g, "#1b1b24", x + 7, hy + 6, 1, 2);
  } else if (face === "right") {
    px(g, hair, x + 2, hy + 3, 4, 6);
    px(g, "#1b1b24", x + 8, hy + 6, 1, 2);
    px(g, "#1b1b24", x + 11, hy + 6, 1, 2);
  } else {
    px(g, hair, x + 2, hy + 3, 1, 5);
    px(g, hair, x + 13, hy + 3, 1, 5);
    px(g, "#1b1b24", x + 5, hy + 6, 1, 2);
    px(g, "#1b1b24", x + 10, hy + 6, 1, 2);
    px(g, "#e88c8c", x + 4, hy + 8, 1, 1);
    px(g, "#e88c8c", x + 11, hy + 8, 1, 1);
  }
}

/** "!" over someone who just spotted you. */
export function drawAlert(g, x, y) {
  x = Math.round(x);
  y = Math.round(y) - 16;
  px(g, "#1b1b24", x + 4, y - 1, 8, 12);
  px(g, "#ffffff", x + 5, y, 6, 10);
  px(g, "#e5484d", x + 7, y + 1, 2, 5);
  px(g, "#e5484d", x + 7, y + 7, 2, 2);
}

/** Small gold star over someone you've beaten. */
export function drawStar(g, x, y) {
  x = Math.round(x) + 6;
  y = Math.round(y) - 12;
  px(g, "#1b1b24", x, y - 1, 4, 5);
  px(g, "#1b1b24", x - 1, y, 6, 3);
  px(g, "#ffcc33", x + 1, y, 2, 3);
  px(g, "#ffcc33", x, y + 1, 4, 1);
}

/** "…" over someone you can talk to (not a challenger). */
export function drawTalk(g, x, y, t) {
  x = Math.round(x) + 3;
  y = Math.round(y) - 13 + (Math.floor(t / 400) % 2);
  px(g, "#1b1b24", x - 1, y - 1, 12, 6);
  px(g, "#ffffff", x, y, 10, 4);
  for (let i = 0; i < 3; i++) px(g, "#1b1b24", x + 2 + i * 3, y + 2, 1, 1);
}

/** Where a tap is taking you. */
export function drawTarget(g, tx, ty, t) {
  const x = tx * TILE;
  const y = ty * TILE;
  const p = Math.floor(t / 150) % 2;
  g.strokeStyle = "#ffffffcc";
  g.lineWidth = 1;
  g.strokeRect(x + 2.5 - p, y + 2.5 - p, 11 + 2 * p, 11 + 2 * p);
}
