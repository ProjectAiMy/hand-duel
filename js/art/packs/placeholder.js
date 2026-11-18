// Placeholder art pack: chibi characters drawn in code, layer by layer, 16×20 px per frame.
// A real pack (your designs, M7) gives the same slots and item ids from sprite sheets instead; saves only store
// item ids, so everyone is redrawn in the new style. Missing items fall back to the slot's default.

export const SKINS = ["#f6d7c3", "#f0c8a0", "#e0ac85", "#c98e62", "#a86b4a", "#7a4a2e"];

const px = (g, c, x, y, w = 1, h = 1) => {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
};
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("")}`;
};
const INK = "#1b1b24";

// ---------- items per slot: id → { name, draw } ----------
// Every draw gets (g, ctx) with ctx = { x, y, face, frame, a (the avatar), skin, bob }.
const BOTTOMS = {
  shorts: { name: "Shorts", draw: (g, c) => legs(g, c, c.a.bottomColor, true) },
  trousers: { name: "Trousers", draw: (g, c) => legs(g, c, c.a.bottomColor, false) },
  skirt: {
    name: "Skirt",
    draw: (g, c) => {
      legs(g, c, c.skin, true);
      px(g, c.a.bottomColor, c.x + 4, c.y + 14 - c.bob, 8, 2);
      px(g, shade(c.a.bottomColor, 0.8), c.x + 3, c.y + 16 - c.bob, 10, 1);
    },
  },
  hakama: {
    name: "Hakama",
    draw: (g, c) => {
      px(g, c.a.bottomColor, c.x + 3, c.y + 14 - c.bob, 10, 4);
      px(g, shade(c.a.bottomColor, 0.75), c.x + 7, c.y + 15 - c.bob, 2, 3);
      px(g, INK, c.x + 4, c.y + 18, 3, 1);
      px(g, INK, c.x + 9, c.y + 18, 3, 1);
    },
  },
};

function legs(g, c, color, bare) {
  const { x, y, frame, face } = c;
  const side = face === "left" || face === "right";
  const lift = [0, frame === 1 ? 1 : 0, frame === 2 ? 1 : 0];
  const [l, r] = side ? [lift[1] + lift[2] ? 1 : 0, 0] : [lift[1], lift[2]];
  const top = c.y + 14 - c.bob;
  if (bare) {
    px(g, color, x + 4, top, 8, 2); // shorts / skirt waist
    px(g, c.skin, x + 5, top + 2 - l, 2, 2);
    px(g, c.skin, x + 9, top + 2 - r, 2, 2);
  } else {
    px(g, color, x + 4, top, 8, 1);
    px(g, color, x + 5, top + 1 - l, 2, 3);
    px(g, color, x + 9, top + 1 - r, 2, 3);
  }
  px(g, INK, x + 5, y + 18 - l, 2, 1);
  px(g, INK, x + 9, y + 18 - r, 2, 1);
}

const TOPS = {
  tee: { name: "T-shirt", sleeves: false, draw: (g, c) => body(g, c, c.a.topColor) },
  hoodie: {
    name: "Hoodie",
    sleeves: true,
    draw: (g, c) => {
      body(g, c, c.a.topColor);
      if (c.face === "down") px(g, shade(c.a.topColor, 0.8), c.x + 6, c.y + 12 - c.bob, 4, 1);
      if (c.face === "up") px(g, shade(c.a.topColor, 0.85), c.x + 4, c.y + 9 - c.bob, 8, 2);
    },
  },
  uniform: {
    name: "Uniform",
    sleeves: true,
    draw: (g, c) => {
      body(g, c, c.a.topColor);
      if (c.face === "down") {
        px(g, "#ffffff", c.x + 6, c.y + 10 - c.bob, 4, 1);
        px(g, "#d62f3c", c.x + 7, c.y + 11 - c.bob, 2, 3);
      }
    },
  },
  gi: {
    name: "Gi",
    sleeves: true,
    draw: (g, c) => {
      body(g, c, c.a.topColor);
      if (c.face === "down") {
        px(g, c.skin, c.x + 7, c.y + 10 - c.bob, 2, 2);
        px(g, shade(c.a.topColor, 0.8), c.x + 6, c.y + 10 - c.bob, 1, 3);
      }
      px(g, INK, c.x + 4, c.y + 13 - c.bob, 8, 1);
    },
  },
  jacket: {
    name: "Jacket",
    sleeves: true,
    draw: (g, c) => {
      body(g, c, c.a.topColor);
      if (c.face === "down") px(g, "#f2f2f2", c.x + 7, c.y + 10 - c.bob, 2, 4);
      if (c.face !== "up") px(g, "#ffcc33", c.x + (c.face === "left" ? 5 : 9), c.y + 11 - c.bob, 1, 1);
    },
  },
  vest: {
    name: "Sweater vest",
    sleeves: false,
    draw: (g, c) => {
      body(g, c, "#f2f2f2");
      px(g, c.a.topColor, c.x + 5, c.y + 10 - c.bob, 6, 4);
      if (c.face === "down") px(g, "#f2f2f2", c.x + 7, c.y + 10 - c.bob, 2, 2);
    },
  },
};

function body(g, c, color) {
  px(g, color, c.x + 4, c.y + 10 - c.bob, 8, 4);
  px(g, shade(color, 0.82), c.x + 4, c.y + 13 - c.bob, 8, 1);
}

function arms(g, c, sleeves) {
  const col = sleeves ? c.a.topColor : c.skin;
  const swing = c.frame === 0 ? 0 : c.frame === 1 ? -1 : 1;
  if (c.face !== "left") {
    px(g, col, c.x + 12, c.y + 10 - c.bob + (c.face === "right" ? 0 : swing), 1, 3);
    px(g, c.skin, c.x + 12, c.y + 13 - c.bob + (c.face === "right" ? 0 : swing), 1, 1);
  }
  if (c.face !== "right") {
    px(g, col, c.x + 3, c.y + 10 - c.bob - (c.face === "left" ? 0 : swing), 1, 3);
    px(g, c.skin, c.x + 3, c.y + 13 - c.bob - (c.face === "left" ? 0 : swing), 1, 1);
  }
}

function head(g, c) {
  const { x, face } = c;
  const y = c.y - c.bob;
  px(g, c.skin, x + 2, y + 1, 12, 9);
  px(g, c.skin, x + 3, y, 10, 1);
  px(g, c.skin, x + 3, y + 10, 10, 1);
  if (face === "up") return;
  const eye = (ex) => {
    px(g, INK, x + ex, y + 6, 1, 2);
    px(g, "#ffffff", x + ex, y + 6, 1, 1);
  };
  if (face === "down") {
    eye(5);
    eye(10);
    px(g, "#e88c8c", x + 4, y + 8, 1, 1);
    px(g, "#e88c8c", x + 11, y + 8, 1, 1);
    px(g, shade(c.skin, 0.75), x + 7, y + 9, 2, 1);
  } else if (face === "left") {
    eye(4);
    eye(7);
    px(g, "#e88c8c", x + 3, y + 8, 1, 1);
  } else {
    eye(8);
    eye(11);
    px(g, "#e88c8c", x + 12, y + 8, 1, 1);
  }
}

// Hair: back layer (behind the head, e.g. long hair seen from the front) and front layer.
const HAIR = {
  none: { name: "None", front: () => {} },
  buzz: {
    name: "Buzz",
    front: (g, c, h) => {
      const y = c.y - c.bob;
      px(g, h, c.x + 3, y, 10, 2);
      if (c.face === "up") px(g, h, c.x + 2, y + 1, 12, 6);
    },
  },
  short: {
    name: "Short",
    front: (g, c, h) => {
      const { x, face } = c;
      const y = c.y - c.bob;
      px(g, h, x + 2, y - 1, 12, 4);
      px(g, h, x + 3, y - 2, 10, 1);
      if (face === "up") px(g, h, x + 2, y + 3, 12, 6);
      else if (face === "left") px(g, h, x + 10, y + 3, 4, 5);
      else if (face === "right") px(g, h, x + 2, y + 3, 4, 5);
      else {
        px(g, h, x + 2, y + 3, 1, 4);
        px(g, h, x + 13, y + 3, 1, 4);
        px(g, h, x + 4, y + 3, 3, 1);
      }
    },
  },
  spiky: {
    name: "Spiky",
    front: (g, c, h) => {
      HAIR.short.front(g, c, h);
      const y = c.y - c.bob;
      for (let i = 0; i < 5; i++) px(g, h, c.x + 2 + i * 3, y - 3 - (i % 2), 2, 2);
    },
  },
  long: {
    name: "Long",
    back: (g, c, h) => {
      const y = c.y - c.bob;
      if (c.face !== "up") px(g, shade(h, 0.85), c.x + 2, y + 3, 12, 9);
    },
    front: (g, c, h) => {
      HAIR.short.front(g, c, h);
      const y = c.y - c.bob;
      if (c.face === "up") px(g, h, c.x + 2, y + 3, 12, 9);
      if (c.face === "down") {
        px(g, h, c.x + 1, y + 3, 2, 8);
        px(g, h, c.x + 13, y + 3, 2, 8);
      }
    },
  },
  bob: {
    name: "Bob",
    front: (g, c, h) => {
      HAIR.short.front(g, c, h);
      const y = c.y - c.bob;
      if (c.face !== "right") px(g, h, c.x + 1, y + 2, 2, 7);
      if (c.face !== "left") px(g, h, c.x + 13, y + 2, 2, 7);
      if (c.face === "down") px(g, h, c.x + 4, y + 3, 8, 1);
    },
  },
  bun: {
    name: "Bun",
    front: (g, c, h) => {
      HAIR.short.front(g, c, h);
      const y = c.y - c.bob;
      px(g, h, c.x + 6, y - 5, 4, 3);
      px(g, shade(h, 1.25), c.x + 7, y - 5, 1, 1);
    },
  },
  ponytail: {
    name: "Ponytail",
    back: (g, c, h) => {
      const y = c.y - c.bob;
      if (c.face === "left") px(g, h, c.x + 13, y + 3, 3, 6);
      if (c.face === "right") px(g, h, c.x, y + 3, 3, 6);
    },
    front: (g, c, h) => {
      HAIR.short.front(g, c, h);
      const y = c.y - c.bob;
      if (c.face === "up") px(g, shade(h, 0.85), c.x + 7, y + 6, 2, 6);
    },
  },
};

const HATS = {
  none: { name: "None", draw: () => {} },
  cap: {
    name: "Cap",
    draw: (g, c, col) => {
      const y = c.y - c.bob;
      px(g, col, c.x + 2, y - 2, 12, 4);
      px(g, shade(col, 1.3), c.x + 7, y - 1, 2, 1);
      if (c.face === "down") px(g, shade(col, 0.75), c.x + 3, y + 2, 10, 1);
      if (c.face === "left") px(g, shade(col, 0.75), c.x, y + 1, 4, 1);
      if (c.face === "right") px(g, shade(col, 0.75), c.x + 12, y + 1, 4, 1);
    },
  },
  band: {
    name: "Headband",
    draw: (g, c, col) => {
      const y = c.y - c.bob;
      px(g, col, c.x + 2, y + 2, 12, 1);
      if (c.face === "up" || c.face === "left") px(g, col, c.x + 13, y + 3, 2, 3);
      if (c.face === "right") px(g, col, c.x + 1, y + 3, 2, 3);
    },
  },
  beanie: {
    name: "Beanie",
    draw: (g, c, col) => {
      const y = c.y - c.bob;
      px(g, col, c.x + 2, y - 2, 12, 4);
      px(g, shade(col, 0.8), c.x + 2, y + 1, 12, 1);
      px(g, "#ffffff", c.x + 7, y - 4, 2, 2);
    },
  },
  crown: {
    name: "Festival crown",
    draw: (g, c) => {
      const y = c.y - c.bob;
      px(g, "#ffcc33", c.x + 4, y - 3, 8, 2);
      for (let i = 0; i < 3; i++) px(g, "#ffcc33", c.x + 4 + i * 3, y - 5, 2, 2);
      px(g, "#e5484d", c.x + 7, y - 3, 2, 1);
    },
  },
  bow: {
    name: "Bow",
    draw: (g, c, col) => {
      const y = c.y - c.bob;
      const bx = c.face === "right" ? c.x + 3 : c.x + 9;
      px(g, col, bx, y - 2, 2, 3);
      px(g, col, bx + 3, y - 2, 2, 3);
      px(g, shade(col, 0.8), bx + 2, y - 1, 1, 1);
    },
  },
};

const EXTRAS = {
  none: { name: "None" },
  glasses: {
    name: "Glasses",
    front: (g, c) => {
      const y = c.y - c.bob + 6;
      if (c.face === "down") {
        px(g, INK, c.x + 4, y - 1, 3, 1);
        px(g, INK, c.x + 9, y - 1, 3, 1);
        px(g, INK, c.x + 7, y - 1, 2, 1);
      } else if (c.face === "left") px(g, INK, c.x + 3, y - 1, 6, 1);
      else if (c.face === "right") px(g, INK, c.x + 7, y - 1, 6, 1);
    },
  },
  scarf: {
    name: "Scarf",
    front: (g, c, col) => {
      const y = c.y - c.bob + 10;
      px(g, col, c.x + 3, y, 10, 2);
      if (c.face === "down") px(g, shade(col, 0.8), c.x + 9, y + 2, 2, 3);
    },
  },
  cape: {
    name: "Cape",
    back: (g, c, col) => {
      if (c.face !== "up") px(g, shade(col, 0.7), c.x + 3, c.y + 10 - c.bob, 10, 7);
    },
    front: (g, c, col) => {
      if (c.face === "up") {
        px(g, col, c.x + 3, c.y + 10 - c.bob, 10, 8);
        px(g, shade(col, 0.8), c.x + 7, c.y + 11 - c.bob, 2, 7);
      }
    },
  },
  bandage: {
    name: "Plaster",
    front: (g, c) => {
      if (c.face === "up") return;
      const bx = c.face === "left" ? c.x + 5 : c.face === "right" ? c.x + 9 : c.x + 10;
      px(g, "#f3d1a6", bx, c.y - c.bob + 8, 3, 1);
    },
  },
  star: {
    name: "Star clip",
    front: (g, c) => {
      const y = c.y - c.bob;
      const sx = c.face === "right" ? c.x + 3 : c.x + 10;
      px(g, "#ffcc33", sx, y, 3, 1);
      px(g, "#ffcc33", sx + 1, y - 1, 1, 3);
    },
  },
};

/** Draw one frame of an avatar with its feet on (x, y + 19). frame: 0 stand, 1 and 2 stepping. */
function draw(g, a, x, y, face, frame) {
  const skin = SKINS[a.skin] ?? SKINS[1];
  const c = { x, y, face, frame, a, skin, bob: frame ? 1 : 0 };
  const top = TOPS[a.top] || TOPS.tee;
  const hair = HAIR[a.hair] || HAIR.short;
  const extra = EXTRAS[a.extra] || EXTRAS.none;
  const extraColor = a.extraColor || "#e5484d";
  px(g, "#00000040", x + 3, y + 18, 10, 2);
  extra.back?.(g, c, extraColor);
  hair.back?.(g, c, a.hairColor);
  (BOTTOMS[a.bottom] || BOTTOMS.shorts).draw(g, c);
  top.draw(g, c);
  arms(g, c, top.sleeves);
  head(g, c);
  hair.front(g, c, a.hairColor);
  extra.front?.(g, c, extraColor);
  (HATS[a.hat] || HATS.none).draw(g, c, a.hatColor || "#3fb6ff");
}

export const pack = {
  id: "placeholder",
  name: "Placeholder",
  frame: { w: 16, h: 24 }, // one sprite frame (feet on the bottom row; room above for hats and spikes)
  top: 4, // draw() y offset inside a frame
  dirs: ["down", "left", "right", "up"],
  frames: 3, // stand, step, step
  slots: { hair: HAIR, top: TOPS, bottom: BOTTOMS, hat: HATS, extra: EXTRAS },
  defaults: { hair: "short", top: "uniform", bottom: "trousers", hat: "none", extra: "none" },
  draw,
};
