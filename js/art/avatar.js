// Avatars are data: a small object of item ids and colours, the same shape for you, every NPC and (later) online
// players. The art pack draws them; each avatar is baked once into a sprite sheet and cached.
import { pack as placeholder, SKINS } from "./packs/placeholder.js";

export { SKINS };
export const AVATAR_V = 1;
let pack = placeholder;
export const currentPack = () => pack;

export const COLORS = [
  "#2a2236", "#6b3e26", "#c2410c", "#f0b429", "#e5e7eb", "#e5484d", "#f472b6", "#a855f7",
  "#3b82f6", "#3fb6ff", "#14b8a6", "#16a34a", "#84cc16", "#475569", "#111827", "#ffffff",
];

export const DEFAULT_AVATAR = Object.freeze({
  v: AVATAR_V, skin: 1, hair: "short", hairColor: "#2a2236", top: "uniform", topColor: "#3b4a8c",
  bottom: "trousers", bottomColor: "#2b2f55", hat: "none", hatColor: "#3fb6ff", extra: "none", extraColor: "#e5484d",
});

/**
 * Items that have to be earned. lock: { stamp } from a club captain, { coins } to buy at your locker,
 * or { flag } from the story. Anything not listed here is free.
 */
export const LOCKS = {
  "top:gi": { stamp: "stone" },
  "hat:band": { stamp: "stone" },
  "bottom:hakama": { stamp: "paper" },
  "hair:bun": { stamp: "paper" },
  "extra:bandage": { stamp: "blade" },
  "top:jacket": { stamp: "blade" },
  "extra:cape": { stamp: "mirror" },
  "hat:crown": { stamp: "final" },
  "extra:star": { flag: "storyDone" },
  "extra:glasses": { coins: 60 },
  "extra:scarf": { coins: 80 },
  "hat:beanie": { coins: 100 },
  "hat:bow": { coins: 100 },
  "hair:ponytail": { coins: 120 },
};
const STAMP_NAMES = { stone: "Stone", paper: "Paper", blade: "Blade", mirror: "Mirror", final: "Final" };

export const lockOf = (slot, id) => LOCKS[`${slot}:${id}`] || null;

/** Is this item yours? `save` has stamps, flags and bought items. */
export function owned(slot, id, save) {
  const l = lockOf(slot, id);
  if (!l) return true;
  if (l.stamp) return !!save?.stamps?.includes(l.stamp);
  if (l.flag) return !!save?.flags?.[l.flag];
  return !!save?.items?.includes(`${slot}:${id}`);
}

export function lockText(slot, id) {
  const l = lockOf(slot, id);
  if (!l) return "";
  if (l.stamp) return `Earn the ${STAMP_NAMES[l.stamp]} stamp`;
  if (l.flag) return "Finish the story";
  return `${l.coins} coins at your locker`;
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Any avatar-like object to a valid avatar for the current pack (unknown items fall back to defaults). */
export function normalizeAvatar(a = {}) {
  const out = { ...DEFAULT_AVATAR };
  if (!a || typeof a !== "object") return out;
  if (Number.isInteger(a.skin) && a.skin >= 0 && a.skin < SKINS.length) out.skin = a.skin;
  for (const slot of Object.keys(pack.slots)) if (typeof a[slot] === "string") out[slot] = pack.slots[slot][a[slot]] ? a[slot] : pack.defaults[slot];
  for (const k of ["hairColor", "topColor", "bottomColor", "hatColor", "extraColor"]) if (HEX.test(a[k] || "")) out[k] = a[k];
  return out;
}

/** Drop items the player doesn't own (e.g. after loading an old save code). */
export function ownedOnly(a, save) {
  const out = { ...a };
  for (const slot of Object.keys(pack.slots)) if (!owned(slot, out[slot], save)) out[slot] = pack.defaults[slot];
  return out;
}

const sheets = new Map();
/** Sprite sheet: one row per direction (down, left, right, up), `pack.frames` frames per row. Cached. */
export function sheetFor(avatar) {
  const a = normalizeAvatar(avatar);
  const key = JSON.stringify(a);
  let c = sheets.get(key);
  if (c) return c;
  const { w, h } = pack.frame;
  c = document.createElement("canvas");
  c.width = w * pack.frames;
  c.height = h * pack.dirs.length;
  const g = c.getContext("2d");
  pack.dirs.forEach((dir, row) => {
    for (let f = 0; f < pack.frames; f++) pack.draw(g, a, f * w, row * h + pack.top, dir, f);
  });
  if (sheets.size > 200) sheets.clear();
  sheets.set(key, c);
  return c;
}

/** Draw a frame of an avatar's sheet with the frame's top-left at (x, y). */
export function drawFrame(g, avatar, x, y, face = "down", frame = 0) {
  const { w, h } = pack.frame;
  const row = Math.max(0, pack.dirs.indexOf(face));
  g.drawImage(sheetFor(avatar), frame * w, row * h, w, h, Math.round(x), Math.round(y), w, h);
}

/** A standalone canvas of one frame, scaled up with crisp pixels (creator preview, battle view). */
export function avatarCanvas(avatar, { face = "down", frame = 0, scale = 6, canvas = null } = {}) {
  const { w, h } = pack.frame;
  const c = canvas || document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  const row = Math.max(0, pack.dirs.indexOf(face));
  g.drawImage(sheetFor(avatar), frame * w, row * h, w, h, 0, 0, w * scale, h * scale);
  return c;
}

/** Head-and-shoulders portrait for dialogue boxes. */
export function portraitCanvas(avatar, scale = 5) {
  const { w } = pack.frame;
  const c = document.createElement("canvas");
  c.width = w * scale;
  const rows = pack.top + 14;
  c.height = rows * scale;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(sheetFor(avatar), 0, 0, w, rows, 0, 0, w * scale, rows * scale);
  return c;
}

/** Items in a slot, in pack order: [{ id, name }]. */
export const itemsIn = (slot) => Object.entries(pack.slots[slot]).map(([id, it]) => ({ id, name: it.name }));
