// Face masks: a picture painted on the face's flat "map" (MediaPipe's canonical face UVs), stretched
// over the 468-point face mesh with WebGL every frame, so it bends with the face when you talk,
// smile or turn. Eyes and mouth are cut out, so your real ones show through.
//
// Masks are drawn here in code (no image files). The painter works in UV space: u runs across the
// face from the right cheek edge to the left (0..1), v from the forehead top down to below the chin.
import { UV, TRIS } from "./facemesh.js";

/** shade: how much the camera's own light and shadow darkens or lightens the mask (0 = none). */
export const MASKS = [
  { id: "none", label: "None" },
  { id: "warpaint", label: "War paint", shade: 0.7 },
  { id: "tiger", label: "Tiger", shade: 0.6 },
  { id: "skull", label: "Skull", shade: 0.55 },
  { id: "robot", label: "Robot", shade: 0.4 },
  { id: "clown", label: "Clown", shade: 0.55 },
  { id: "ninja", label: "Ninja", shade: 0.6, mouth: false },
];
const byId = (id) => MASKS.find((m) => m.id === id) || MASKS[0];

// Contours of the face mesh (landmark indices).
const EYE_R = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_L = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

// ---------- painting ----------

/** Paint mask `id` onto a new S×S canvas in face-map space. */
export function paintMask(id, S = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  const m = byId(id);
  if (m.id === "none") return c;
  const pt = (i) => [UV[2 * i] * S, UV[2 * i + 1] * S];
  const X = (u) => u * S;
  const poly = (ids, grow = 1) => {
    const pts = ids.map(pt);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    ctx.beginPath();
    pts.forEach(([x, y], k) => {
      const px = cx + (x - cx) * grow;
      const py = cy + (y - cy) * grow;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.closePath();
  };
  const ellipse = (u, v, ru, rv, fill) => {
    ctx.beginPath();
    ctx.ellipse(X(u), X(v), X(ru), X(rv), 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const stroke = (pts, width, color, glow = 0) => {
    ctx.beginPath();
    pts.forEach(([u, v], k) => (k ? ctx.lineTo(X(u), X(v)) : ctx.moveTo(X(u), X(v))));
    ctx.lineWidth = X(width);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow ? X(glow) : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
  const shape = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([u, v], k) => (k ? ctx.lineTo(X(u), X(v)) : ctx.moveTo(X(u), X(v))));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const base = (inner, outer) => {
    const g = ctx.createRadialGradient(X(0.5), X(0.5), X(0.1), X(0.5), X(0.5), X(0.62));
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    poly(OVAL, 1.04);
    ctx.fillStyle = g;
    ctx.fill();
  };
  // Mirror a painting step onto the other half of the face.
  const both = (fn) => {
    fn((u) => u);
    fn((u) => 1 - u);
  };

  PAINT[m.id]({ ctx, S, X, pt, poly, ellipse, stroke, shape, base, both });

  // Cut out the eyes and (usually) the mouth.
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  poly(EYE_R, 1.12);
  ctx.fill();
  poly(EYE_L, 1.12);
  ctx.fill();
  if (m.mouth !== false) {
    poly(LIPS_IN, 1.05);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  return c;
}

const PAINT = {
  warpaint({ stroke, both }) {
    // Two bars under each eye and a stripe down the forehead, with a rough brushed edge.
    both((f) => {
      for (let k = 0; k < 3; k++) {
        const j = k * 0.004;
        stroke([[f(0.17), 0.47 + j], [f(0.42), 0.5 - j]], 0.035, "rgba(18,18,22,.85)");
        stroke([[f(0.15), 0.535 + j], [f(0.4), 0.565 - j]], 0.03, "rgba(196,28,36,.85)");
      }
    });
    for (let k = 0; k < 3; k++) {
      const j = (k - 1) * 0.006;
      stroke([[0.5 + j, 0.13], [0.5 - j, 0.33]], 0.03, "rgba(196,28,36,.8)");
    }
    stroke([[0.5, 0.79], [0.5, 0.9]], 0.022, "rgba(18,18,22,.8)");
  },

  tiger({ ctx, X, poly, ellipse, stroke, shape, base, both }) {
    base("#ffab3d", "#d9640f");
    // White muzzle, chin and brow patches.
    ellipse(0.5, 0.76, 0.2, 0.17, "#fff6e6");
    both((f) => ellipse(f(0.33), 0.29, 0.09, 0.045, "#fff2dc"));
    // Black stripes: forehead wedges and cheek wedges coming in from the sides.
    const dark = "#1c120c";
    shape([[0.5, 0.13], [0.47, 0.25], [0.5, 0.29], [0.53, 0.25]], dark);
    both((f) => {
      shape([[f(0.37), 0.12], [f(0.42), 0.2], [f(0.4), 0.24], [f(0.355), 0.16]], dark);
      shape([[f(0.26), 0.15], [f(0.33), 0.21], [f(0.3), 0.23], [f(0.245), 0.19]], dark);
      for (const [v, len] of [[0.47, 0.17], [0.57, 0.2], [0.67, 0.15]]) {
        shape([[f(0.01), v - 0.03], [f(0.01 + len), v], [f(0.01), v + 0.025]], dark);
      }
    });
    // Nose, the line down to the lip, and dark eye rims.
    shape([[0.44, 0.52], [0.56, 0.52], [0.5, 0.585]], dark);
    stroke([[0.5, 0.58], [0.5, 0.66]], 0.012, dark);
    ctx.lineWidth = X(0.018);
    ctx.strokeStyle = dark;
    poly(EYE_R, 1.25);
    ctx.stroke();
    poly(EYE_L, 1.25);
    ctx.stroke();
  },

  skull({ ctx, X, ellipse, shape, base, both }) {
    base("#f4efe2", "#a8a294");
    // Hollow cheeks and temples.
    both((f) => {
      for (const [u, v, r, a] of [[f(0.22), 0.62, 0.11, 0.4], [f(0.12), 0.3, 0.09, 0.3]]) {
        const g = ctx.createRadialGradient(X(u), X(v), 0, X(u), X(v), X(r));
        g.addColorStop(0, `rgba(80,74,64,${a})`);
        g.addColorStop(1, "rgba(80,74,64,0)");
        ctx.fillStyle = g;
        ctx.fillRect(X(u - r), X(v - r), X(2 * r), X(2 * r));
      }
    });
    // Eye sockets with soft edges.
    both((f) => {
      const g = ctx.createRadialGradient(X(f(0.35)), X(0.385), X(0.04), X(f(0.35)), X(0.385), X(0.13));
      g.addColorStop(0, "#0b0a0a");
      g.addColorStop(0.65, "#1d1a18");
      g.addColorStop(1, "rgba(29,26,24,0)");
      ctx.fillStyle = g;
      ctx.fillRect(X(f(0.35) - 0.14), X(0.25), X(0.28), X(0.27));
    });
    // Nose cavity.
    both((f) => shape([[f(0.5), 0.47], [f(0.455), 0.555], [f(0.49), 0.575], [f(0.5), 0.56]], "#141210"));
    // Teeth across the lips.
    ctx.fillStyle = "#fbf8ef";
    ctx.fillRect(X(0.35), X(0.655), X(0.3), X(0.08));
    ctx.strokeStyle = "#2a2622";
    ctx.lineWidth = X(0.006);
    ctx.strokeRect(X(0.35), X(0.655), X(0.3), X(0.08));
    ctx.beginPath();
    ctx.moveTo(X(0.35), X(0.694));
    ctx.lineTo(X(0.65), X(0.694));
    for (let k = 1; k < 8; k++) {
      ctx.moveTo(X(0.35 + k * 0.0375), X(0.655));
      ctx.lineTo(X(0.35 + k * 0.0375), X(0.735));
    }
    ctx.stroke();
  },

  robot({ ctx, X, poly, ellipse, stroke, both }) {
    const g = ctx.createLinearGradient(0, 0, X(1), X(1));
    g.addColorStop(0, "#c4ccd6");
    g.addColorStop(0.5, "#7d8792");
    g.addColorStop(1, "#4a525c");
    poly(OVAL, 1.04);
    ctx.fillStyle = g;
    ctx.fill();
    // Panel seams.
    const seam = "rgba(30,34,40,.85)";
    stroke([[0.5, 0.1], [0.5, 0.33]], 0.008, seam);
    stroke([[0.08, 0.23], [0.92, 0.23]], 0.008, seam);
    both((f) => {
      stroke([[f(0.16), 0.46], [f(0.3), 0.6], [f(0.3), 0.86]], 0.008, seam);
      stroke([[f(0.02), 0.62], [f(0.3), 0.6]], 0.008, seam);
    });
    // Glowing cyan circuit lines.
    const cyan = "#38f2ff";
    stroke([[0.3, 0.17], [0.42, 0.17], [0.46, 0.13]], 0.008, cyan, 0.02);
    stroke([[0.7, 0.17], [0.58, 0.17], [0.54, 0.13]], 0.008, cyan, 0.02);
    both((f) => stroke([[f(0.06), 0.52], [f(0.14), 0.52], [f(0.22), 0.6], [f(0.22), 0.74]], 0.008, cyan, 0.02));
    // Rivets.
    for (const [u, v] of [[0.14, 0.27], [0.86, 0.27], [0.38, 0.27], [0.62, 0.27], [0.26, 0.82], [0.74, 0.82], [0.1, 0.66], [0.9, 0.66]]) {
      ellipse(u, v, 0.012, 0.012, "#2b3036");
      ellipse(u - 0.003, v - 0.003, 0.006, 0.006, "#e6ecf2");
    }
    // Chin grille.
    for (let k = 0; k < 4; k++) stroke([[0.42, 0.8 + k * 0.025], [0.58, 0.8 + k * 0.025]], 0.008, seam);
    // Red glow around the eyes.
    ctx.shadowColor = "#ff3b3b";
    ctx.shadowBlur = X(0.03);
    ctx.lineWidth = X(0.014);
    ctx.strokeStyle = "#ff4545";
    poly(EYE_R, 1.35);
    ctx.stroke();
    poly(EYE_L, 1.35);
    ctx.stroke();
    ctx.shadowBlur = 0;
  },

  clown({ ctx, X, poly, ellipse, shape, stroke, base, both }) {
    base("#fffdf8", "#ece6dc");
    // Rosy cheeks.
    both((f) => {
      const g = ctx.createRadialGradient(X(f(0.24)), X(0.6), 0, X(f(0.24)), X(0.6), X(0.08));
      g.addColorStop(0, "rgba(255,90,120,.7)");
      g.addColorStop(1, "rgba(255,90,120,0)");
      ctx.fillStyle = g;
      ctx.fillRect(X(f(0.24) - 0.09), X(0.51), X(0.18), X(0.18));
    });
    // Blue diamonds through the eyes and high arched brows.
    both((f) => {
      shape([[f(0.35), 0.24], [f(0.395), 0.39], [f(0.35), 0.53], [f(0.305), 0.39]], "#2f6bff");
      stroke([[f(0.25), 0.29], [f(0.33), 0.22], [f(0.43), 0.26]], 0.014, "#1d1d24");
    });
    // Big red smile over the lips.
    poly(LIPS_OUT, 1.35);
    ctx.fillStyle = "#e3192f";
    ctx.fill();
    both((f) => stroke([[f(0.36), 0.69], [f(0.32), 0.65]], 0.03, "#e3192f"));
    // Red nose ball.
    const g = ctx.createRadialGradient(X(0.485), X(0.52), X(0.01), X(0.5), X(0.54), X(0.075));
    g.addColorStop(0, "#ff7a7a");
    g.addColorStop(0.4, "#f01c2c");
    g.addColorStop(1, "#a30d18");
    ellipse(0.5, 0.54, 0.072, 0.065, g);
  },

  ninja({ ctx, X, poly, shape, stroke }) {
    // Cloth over the nose, mouth and chin (the mouth isn't cut out).
    ctx.save();
    poly(OVAL, 1.04);
    ctx.clip();
    const cloth = ctx.createLinearGradient(0, X(0.45), 0, X(1));
    cloth.addColorStop(0, "#2a2c3a");
    cloth.addColorStop(1, "#14151d");
    ctx.beginPath();
    ctx.moveTo(0, X(0.47));
    ctx.quadraticCurveTo(X(0.5), X(0.43), X(1), X(0.47));
    ctx.lineTo(X(1), X(1));
    ctx.lineTo(0, X(1));
    ctx.closePath();
    ctx.fillStyle = cloth;
    ctx.fill();
    // Fabric folds.
    for (let k = 0; k < 6; k++) {
      const v = 0.56 + k * 0.065;
      stroke([[0.08, v], [0.5, v - 0.03], [0.92, v]], 0.006, "rgba(255,255,255,.07)");
    }
    // Headband with a metal plate.
    shape([[0, 0.12], [1, 0.12], [1, 0.22], [0, 0.22]], "#1b1c26");
    ctx.restore();
    const plate = ctx.createLinearGradient(0, X(0.12), 0, X(0.22));
    plate.addColorStop(0, "#eef2f6");
    plate.addColorStop(1, "#7f8a96");
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.roundRect(X(0.39), X(0.125), X(0.22), X(0.09), X(0.015));
    ctx.fill();
    ctx.strokeStyle = "#3d454e";
    ctx.lineWidth = X(0.007);
    ctx.beginPath();
    ctx.arc(X(0.5), X(0.17), X(0.025), 0.3, Math.PI * 1.7);
    ctx.stroke();
  },
};

/** A small preview of a mask for the picker (data URL). */
export function maskThumb(id) {
  const tex = paintMask(id, 96);
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e0b394"; // a plain skin tone behind, so cut-outs and paint read clearly
  ctx.beginPath();
  ctx.ellipse(32, 34, 24, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.drawImage(tex, 0, 0, 96, 96, 4, 2, 56, 64);
  ctx.restore();
  return c.toDataURL();
}

// ---------- rendering ----------

const VERT = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute float aEdge;
varying vec2 vUV;
varying vec2 vScreen;
varying float vEdge;
void main() {
  vUV = aUV;
  vScreen = aPos.xy;
  vEdge = aEdge;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, clamp(aPos.z * 2.0, -1.0, 1.0), 1.0);
}`;
const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform sampler2D uVideo;
uniform float uShade;
varying vec2 vUV;
varying vec2 vScreen;
varying float vEdge;
void main() {
  vec4 c = texture2D(uTex, vUV); // premultiplied
  float lum = dot(texture2D(uVideo, vScreen).rgb, vec3(0.299, 0.587, 0.114));
  float s = mix(1.0, clamp(lum * 1.9, 0.45, 1.35), uShade);
  float a = c.a * smoothstep(0.0, 0.8, vEdge); // fade out at the face's outline
  if (a < 0.01) discard;
  gl_FragColor = vec4(c.rgb * s * smoothstep(0.0, 0.8, vEdge), a);
}`;

const N = 468; // mesh points (the tracker's extra 10 are the irises)

/** Draws masks onto its own WebGL canvas, the same size as the effects canvas. */
export class MaskRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;

    const buffer = (data, attr, size, usage = gl.STATIC_DRAW) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      const loc = gl.getAttribLocation(prog, attr);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    buffer(UV, "aUV", 2);
    const edge = new Float32Array(N).fill(1);
    for (const i of OVAL) edge[i] = 0;
    buffer(edge, "aEdge", 1);
    this.pos = new Float32Array(N * 3);
    this.posBuf = buffer(this.pos, "aPos", 3, gl.DYNAMIC_DRAW);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, TRIS, gl.STATIC_DRAW);

    const tex = (unit, name) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
      return t;
    };
    this.maskTex = tex(0, "uTex");
    this.videoTex = tex(1, "uVideo");
    this.uShade = gl.getUniformLocation(prog, "uShade");
    this.maskId = null;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
  }

  _setMask(id) {
    if (id === this.maskId) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintMask(id, 512));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.maskId = id;
  }

  /**
   * Draw mask `id` on each face. faces = arrays of landmarks ({x, y, z}, normalized to the video).
   * Returns the canvas to draw over the picture.
   */
  draw(video, faces, id, W, H) {
    const gl = this.gl;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._setMask(id);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1f(this.uShade, byId(id).shade || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    for (const lm of faces) {
      for (let i = 0; i < N; i++) {
        this.pos[i * 3] = lm[i].x;
        this.pos[i * 3 + 1] = lm[i].y;
        this.pos[i * 3 + 2] = lm[i].z;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
      gl.drawElements(gl.TRIANGLES, TRIS.length, gl.UNSIGNED_SHORT, 0);
    }
    return this.canvas;
  }
}
