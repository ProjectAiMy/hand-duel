// Video cosmetics, like the effects in a video call: face masks that bend with the face
// (js/masks.js), face stickers and emoji avatars, background blur or replacement, and colour filters.
//
// The camera <video> keeps playing underneath (hand tracking reads it untouched); this draws the
// styled picture onto a canvas laid over it. Online, the canvas is what the opponent receives.
// MediaPipe models load only when a look needs them: the face model for masks and stickers, the
// selfie segmenter for backgrounds.
import { MASKS, MaskRenderer } from "./masks.js";

const MP_VERSION = "0.10.14";
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const SEG_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

const MAX_WIDTH = 720; // the styled picture (and the stream sent online) is capped at this width
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

/**
 * kind: where a face look sits. eyes = across the eyes, top = on the head, nose = on the nose tip,
 * mask = covers the whole face (an emoji avatar). size is relative to the face's width.
 */
export const LOOKS = {
  face: [
    { id: "none", emoji: "∅", label: "None" },
    { id: "shades", emoji: "🕶️", label: "Shades", kind: "eyes", size: 1.05 },
    { id: "specs", emoji: "👓", label: "Specs", kind: "eyes", size: 1.0 },
    { id: "crown", emoji: "👑", label: "Crown", kind: "top", size: 0.85 },
    { id: "tophat", emoji: "🎩", label: "Top hat", kind: "top", size: 1.0 },
    { id: "cap", emoji: "🧢", label: "Cap", kind: "top", size: 1.05 },
    { id: "clown", emoji: "🔴", label: "Clown", kind: "nose", size: 0.3 },
    { id: "robot", emoji: "🤖", label: "Robot", kind: "mask", size: 1.45 },
    { id: "tiger", emoji: "🐯", label: "Tiger", kind: "mask", size: 1.45 },
    { id: "frog", emoji: "🐸", label: "Frog", kind: "mask", size: 1.45 },
    { id: "alien", emoji: "👽", label: "Alien", kind: "mask", size: 1.45 },
    { id: "monkey", emoji: "🐵", label: "Monkey", kind: "mask", size: 1.45 },
    { id: "skull", emoji: "💀", label: "Skull", kind: "mask", size: 1.4 },
  ],
  background: [
    { id: "none", label: "None" },
    { id: "blur", label: "Blur" },
    { id: "dojo", label: "Dojo", stops: ["#2b0f05", "#7a2e0e", "#d9822b"] },
    { id: "sunset", label: "Sunset", stops: ["#2d1b4e", "#c3426b", "#ffb36b"] },
    { id: "cyber", label: "Cyber", stops: ["#05010f", "#1b0b45", "#3b0f6b"], grid: "#ff3df2" },
    { id: "ocean", label: "Ocean", stops: ["#021a2b", "#0b4f6c", "#36c3c9"] },
    { id: "studio", label: "Studio", stops: ["#1a1c33", "#2b2f55", "#1a1c33"] },
  ],
  mask: MASKS,
  filter: [
    { id: "none", label: "None", css: "none" },
    { id: "glow", label: "Glow", css: "brightness(1.12) contrast(1.05) saturate(1.15)" },
    { id: "warm", label: "Warm", css: "sepia(.3) saturate(1.35) hue-rotate(-8deg)" },
    { id: "cool", label: "Cool", css: "saturate(1.1) hue-rotate(18deg) brightness(1.03)" },
    { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.2)" },
    { id: "retro", label: "Retro", css: "sepia(.65) contrast(1.1) brightness(.95)" },
    { id: "neon", label: "Neon", css: "saturate(2.4) contrast(1.25) hue-rotate(150deg)" },
  ],
};
export const DEFAULT_LOOK = { mask: "none", face: "none", background: "none", filter: "none" };
const byId = (list, id) => list.find((x) => x.id === id) || list[0];

// Face landmark indices (MediaPipe 478-point face mesh).
const L = { eyeL: 33, eyeR: 263, top: 10, chin: 152, nose: 1, cheekL: 234, cheekR: 454 };

export class Effects {
  /**
   * @param {HTMLVideoElement} video camera feed (keeps playing for hand tracking)
   * @param {HTMLCanvasElement} canvas where the styled picture is drawn
   */
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.look = { ...DEFAULT_LOOK };
    this.numFaces = 1;
    this.face = null;
    this.segmenter = null;
    this.loading = null;
    this.onStatus = () => {};
    this.onActiveChange = () => {};
    this._active = false;
    this._running = false;
    this._frame = 0;
    this._lastTime = -1;
    this._faces = []; // smoothed sticker placement per face
    this._meshes = []; // smoothed face-mesh landmarks per face, for masks
    this._masker = null; // MaskRenderer, made on first use
    this._maskFailed = false;
    this._mask = document.createElement("canvas");
    this._maskCtx = this._mask.getContext("2d");
    this._maskData = null;
    this._hasMask = false;
    this._person = document.createElement("canvas");
    this._personCtx = this._person.getContext("2d");
    this._small = document.createElement("canvas");
    this._smallCtx = this._small.getContext("2d");
    this._ctxFilter = typeof this.ctx.filter === "string"; // Safari before 18 can't filter on canvas
    this._stream = null;
  }

  /** True while any look is on, i.e. the canvas (not the raw camera) is what people see. */
  get active() {
    return this._active;
  }

  /** A stream of the styled picture, for sending to an online opponent. */
  get stream() {
    if (!this._stream && this.canvas.captureStream) {
      this._sizeCanvas();
      this._stream = this.canvas.captureStream(30);
    }
    return this._stream;
  }

  /** Apply a look ({face, background, filter}); loads any model it needs. */
  async setLook(look) {
    this.look = { ...this.look, ...look };
    const active = Object.values(this.look).some((v) => v !== "none");
    if (active && !this._running) this._start();
    if (active !== this._active) {
      this._active = active;
      this.canvas.hidden = !active;
      this.video.classList.toggle("behind-fx", active);
      if (!active) this.canvas.style.filter = "";
      this.onActiveChange(active);
    }
    await this._ensureModels();
  }

  async setNumFaces(n) {
    this.numFaces = n;
    if (this.face) await this.face.setOptions({ numFaces: n });
  }

  async _ensureModels() {
    const needFace = (this.look.face !== "none" || this.look.mask !== "none") && !this.face;
    const wantSeg = this.look.background !== "none" && !this.segmenter; // blur needs the cutout too
    if (!needFace && !wantSeg) return;
    if (this.loading) return this.loading.then(() => this._ensureModels());
    this.loading = (async () => {
      try {
        const vision = await import(`${MP_URL}/vision_bundle.mjs`);
        const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
        const withFallback = async (make) => {
          try {
            return await make("GPU");
          } catch {
            return await make("CPU");
          }
        };
        if (needFace) {
          this.onStatus("Loading face tracker…");
          this.face = await withFallback((delegate) =>
            vision.FaceLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: FACE_MODEL, delegate },
              runningMode: "VIDEO",
              numFaces: this.numFaces,
            }),
          );
        }
        if (wantSeg) {
          this.onStatus("Loading background cutout…");
          this.segmenter = await withFallback((delegate) =>
            vision.ImageSegmenter.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: SEG_MODEL, delegate },
              runningMode: "VIDEO",
              outputCategoryMask: false,
              outputConfidenceMasks: true,
            }),
          );
        }
        this.onStatus("");
      } catch (e) {
        console.warn("effects model failed", e);
        this.onStatus("Couldn't load that effect. Check your connection.", true);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  _start() {
    this._running = true;
    const tick = (now) => {
      if (!this._active) {
        this._running = false;
        return;
      }
      requestAnimationFrame(tick);
      try {
        this._render(now);
      } catch (e) {
        console.warn("effects render failed", e);
      }
    };
    requestAnimationFrame(tick);
  }

  _sizeCanvas() {
    const v = this.video;
    const vw = v.videoWidth || 640;
    const vh = v.videoHeight || 480;
    const scale = Math.min(1, MAX_WIDTH / vw);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = this._person.width = w;
      this.canvas.height = this._person.height = h;
    }
    return [w, h];
  }

  _render(now) {
    const v = this.video;
    if (v.readyState < 2 || document.hidden) return;
    const [W, H] = this._sizeCanvas();
    const fresh = v.currentTime !== this._lastTime;
    this._lastTime = v.currentTime;
    const ts = performance.now();
    const look = this.look;
    const bg = byId(LOOKS.background, look.background);
    const filter = byId(LOOKS.filter, look.filter).css;

    // Run the models on new frames only. The cutout runs every frame (edges lag visibly
    // otherwise). The face model runs every frame for a mask, which has to stay locked on, and
    // every other frame when it's only placing a sticker.
    const wantMask = look.mask !== "none" && !this._maskFailed;
    if (fresh) {
      this._frame++;
      if (this.segmenter && bg.id !== "none") this._segment(v, ts);
      const faceOn = look.face !== "none" || wantMask;
      if (this.face && faceOn && (wantMask || this._frame % 2 === 0)) this._detectFaces(v, ts);
    }

    const ctx = this.ctx;
    const useCtxFilter = this._ctxFilter && filter !== "none";
    // Without canvas filters (older Safari) the colour filter is CSS on the canvas: you see it,
    // your online opponent doesn't.
    this.canvas.style.filter = !this._ctxFilter && filter !== "none" ? filter : "";

    ctx.globalCompositeOperation = "source-over";
    if (bg.id === "none" || !this._hasMask) {
      // No background look, or the cutout isn't ready yet: plain camera.
      ctx.filter = useCtxFilter ? filter : "none";
      ctx.drawImage(v, 0, 0, W, H);
      ctx.filter = "none";
    } else {
      // Person layer: camera cut out by the segmenter's mask.
      const p = this._personCtx;
      p.globalCompositeOperation = "copy";
      p.filter = useCtxFilter ? filter : "none";
      p.drawImage(v, 0, 0, W, H);
      p.filter = "none";
      p.globalCompositeOperation = "destination-in";
      p.imageSmoothingEnabled = true;
      p.drawImage(this._mask, 0, 0, W, H);
      p.globalCompositeOperation = "source-over";

      if (bg.id === "blur") this._blurred(v, W, H, useCtxFilter ? filter : "none");
      else this._paintBackground(bg, W, H, ts);
      ctx.drawImage(this._person, 0, 0);
    }

    if (wantMask) this._drawMasks(v, look.mask, W, H, useCtxFilter ? filter : "none");
    if (look.face !== "none") this._drawFaces(byId(LOOKS.face, look.face), W, H);
  }

  _drawMasks(v, id, W, H, filter) {
    const now = performance.now();
    const faces = this._meshes.filter((m) => now - m.seen < 400).map((m) => m.pts);
    if (!faces.length) return;
    try {
      this._masker ||= new MaskRenderer();
      const ctx = this.ctx;
      ctx.filter = filter;
      ctx.drawImage(this._masker.draw(v, faces, id, W, H), 0, 0);
      ctx.filter = "none";
    } catch (e) {
      console.warn("mask renderer failed", e);
      this._maskFailed = true;
      this.onStatus("Masks need WebGL, which this browser has turned off.", true);
    }
  }

  _segment(v, ts) {
    this.segmenter.segmentForVideo(v, ts, (res) => {
      const m = res.confidenceMasks?.[0];
      if (!m) return;
      const w = m.width;
      const h = m.height;
      const data = m.getAsFloat32Array();
      if (this._mask.width !== w || this._mask.height !== h) {
        this._mask.width = w;
        this._mask.height = h;
        this._maskData = this._maskCtx.createImageData(w, h);
      }
      const px = this._maskData.data;
      for (let i = 0; i < data.length; i++) {
        // Soft edge: below .35 is background, above .65 is you, a short ramp between.
        const a = Math.min(1, Math.max(0, (data[i] - 0.35) / 0.3));
        px[i * 4 + 3] = a * 255;
      }
      this._maskCtx.putImageData(this._maskData, 0, 0);
      this._hasMask = true;
    });
  }

  /** Cheap, works everywhere: shrink the frame a lot, then scale it back up smoothly. */
  _blurred(v, W, H, filter) {
    const s = this._small;
    const sw = Math.max(8, Math.round(W / 18));
    const sh = Math.max(6, Math.round(H / 18));
    if (s.width !== sw || s.height !== sh) {
      s.width = sw;
      s.height = sh;
    }
    this._smallCtx.imageSmoothingEnabled = true;
    this._smallCtx.drawImage(v, 0, 0, sw, sh);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = filter;
    ctx.drawImage(s, 0, 0, W, H);
    ctx.filter = "none";
  }

  _paintBackground(bg, W, H, t) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    bg.stops.forEach((c, i) => g.addColorStop(i / (bg.stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (bg.grid) {
      // Retro floor grid scrolling toward you.
      ctx.save();
      ctx.strokeStyle = bg.grid;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1, W / 400);
      const horizon = H * 0.55;
      for (let i = -10; i <= 10; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * (W / 20), horizon);
        ctx.lineTo(W / 2 + i * (W / 3), H);
        ctx.stroke();
      }
      const off = (t / 1000) % 1;
      for (let k = 0; k < 8; k++) {
        const y = horizon + (H - horizon) * ((k + off) / 8) ** 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // A soft spotlight behind you.
      const r = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.6);
      r.addColorStop(0, "rgba(255,255,255,.18)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }
  }

  _detectFaces(v, ts) {
    const res = this.face.detectForVideo(v, ts);
    const faces = res.faceLandmarks || [];
    this._meshes = faces.map((lm, i) => this._smoothMesh(lm, this._meshes[i], ts));
    this._faces = faces.map((lm, i) => {
      const P = (k) => ({ x: lm[k].x, y: lm[k].y });
      const next = {
        eyeL: P(L.eyeL), eyeR: P(L.eyeR), top: P(L.top), chin: P(L.chin), nose: P(L.nose),
        cheekL: P(L.cheekL), cheekR: P(L.cheekR), seen: ts,
      };
      // Smooth so stickers don't jitter.
      const prev = this._faces[i];
      if (!prev) return next;
      for (const k of Object.keys(next)) {
        if (k === "seen") continue;
        next[k] = { x: prev[k].x * 0.4 + next[k].x * 0.6, y: prev[k].y * 0.4 + next[k].y * 0.6 };
      }
      return next;
    });
  }

  /**
   * Ease the mesh toward the new points: a little smoothing stops shimmer without dragging behind
   * fast moves. Start fresh if the face jumped (a different face, with two players).
   */
  _smoothMesh(lm, prev, ts) {
    const n = Math.min(lm.length, 468);
    if (!prev || Math.hypot(prev.pts[1].x - lm[1].x, prev.pts[1].y - lm[1].y) > 0.15) {
      return { pts: lm.slice(0, n).map((p) => ({ x: p.x, y: p.y, z: p.z })), seen: ts };
    }
    // Follow faster when the face moves a lot, so the mask doesn't trail.
    const move = Math.hypot(prev.pts[1].x - lm[1].x, prev.pts[1].y - lm[1].y);
    const k = Math.min(1, 0.55 + move * 25);
    for (let i = 0; i < n; i++) {
      const a = prev.pts[i];
      const b = lm[i];
      a.x += (b.x - a.x) * k;
      a.y += (b.y - a.y) * k;
      a.z += (b.z - a.z) * k;
    }
    prev.seen = ts;
    return prev;
  }

  _drawFaces(item, W, H) {
    const ctx = this.ctx;
    const now = performance.now();
    for (const f of this._faces) {
      if (now - f.seen > 400) continue; // face lost: don't leave a sticker floating
      const px = (p) => ({ x: p.x * W, y: p.y * H });
      const eL = px(f.eyeL);
      const eR = px(f.eyeR);
      const top = px(f.top);
      const chin = px(f.chin);
      const faceW = Math.hypot(px(f.cheekR).x - px(f.cheekL).x, px(f.cheekR).y - px(f.cheekL).y);
      const faceH = Math.hypot(chin.x - top.x, chin.y - top.y);
      const angle = Math.atan2(eR.y - eL.y, eR.x - eL.x);
      // "Up" for this face, from chin to forehead.
      const up = { x: (top.x - chin.x) / (faceH || 1), y: (top.y - chin.y) / (faceH || 1) };
      let at;
      let size = faceW * item.size;
      if (item.kind === "eyes") at = { x: (eL.x + eR.x) / 2, y: (eL.y + eR.y) / 2 };
      else if (item.kind === "nose") at = px(f.nose);
      else if (item.kind === "top") {
        at = { x: top.x + up.x * size * 0.42, y: top.y + up.y * size * 0.42 };
      } else {
        at = { x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2 };
        size = Math.max(faceW, faceH) * item.size * 0.8;
      }
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.rotate(angle);
      ctx.font = `${Math.round(size)}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,.35)";
      ctx.shadowBlur = size * 0.06;
      ctx.fillText(item.emoji, 0, item.kind === "mask" ? size * 0.04 : 0);
      ctx.restore();
    }
  }
}
