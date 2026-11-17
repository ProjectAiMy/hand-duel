// Hand cursor: point with your palm, hold over a button to press it (dwell), so menus work without a mouse.
// Smoothing is a One Euro filter: steady when the hand is still, little lag when it moves fast.

/** One Euro filter (Casiez et al. 2012) for one value. Times in seconds. */
export class OneEuro {
  constructor(minCutoff = 1, beta = 0.007, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  filter(x, t) {
    if (this.x === null || t <= this.t) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = Math.min(0.5, t - this.t);
    this.t = t;
    const a = (cutoff) => {
      const r = 2 * Math.PI * cutoff * dt;
      return r / (r + 1);
    };
    const dx = (x - this.x) / dt;
    this.dx += a(this.dCutoff) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += a(cutoff) * (x - this.x);
    return this.x;
  }
}

/** Camera-space point (0-1, as the player sees it) to screen fraction, with gain around the centre. */
export function mapPoint(x, y, speed) {
  const m = (v) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * speed));
  return [m(x), m(y)];
}

/** Smoothing slider (0-100) to the filter's minimum cutoff in Hz: lower = steadier. */
export const cutoffFor = (smoothing) => 3.5 - (smoothing / 100) * 3.1;

/** Palm centre from 21 hand landmarks: steadier than a fingertip, and doesn't jump when fingers curl. */
export function palmPoint(lm) {
  const ids = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return [x / ids.length, y / ids.length];
}

const TARGETS =
  "button:not(:disabled), [data-dwell], label.toggle-row, select:not(:disabled), summary, a[href]";
const STICK = 22; // px: keep the current target while within this much of it (no flicker at edges)
const MAGNET = 18; // px: snap to a target this close, so buttons have generous hitboxes
const LOST_MS = 350; // hide the cursor after the hand has been gone this long

export class HandCursor {
  /**
   * @param {object} o
   * @param {() => Element|null} o.scope where the cursor may press things; null hides it
   * @param {() => object} o.config { enabled, smoothing, speed, dwell }
   * @param {(el: Element) => void} [o.onPress]
   * @param {(el: Element) => void} [o.onHover]
   */
  constructor({ scope, config, onPress, onHover }) {
    this.scope = scope;
    this.config = config;
    this.onPress = onPress;
    this.onHover = onHover;
    this.fx = new OneEuro();
    this.fy = new OneEuro();
    this.target = null;
    this.since = 0;
    this.pressed = null; // the element just pressed: needs the cursor to leave before it can fire again
    this.lastSeen = -1e9;
    this.shown = false;
    this.el = document.createElement("div");
    this.el.className = "hand-cursor";
    this.el.setAttribute("aria-hidden", "true");
    this.el.innerHTML =
      '<svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="27"/>' +
      '<circle class="prog" cx="32" cy="32" r="27" pathLength="100"/></svg><i></i><span></span>';
    this.prog = this.el.querySelector(".prog");
    this.label = this.el.querySelector("span");
    document.body.appendChild(this.el);
  }

  /** Call once per tracked frame. `pt` is [x, y] in 0-1 as the player sees it, or null with no hand. */
  update(pt, nowMs) {
    const cfg = this.config();
    const scope = cfg.enabled ? this.scope() : null;
    if (!scope) return this._hide();
    if (!pt) {
      if (nowMs - this.lastSeen > LOST_MS) this._hide(true);
      return;
    }
    this.lastSeen = nowMs;
    const t = nowMs / 1000;
    const vw = innerWidth;
    const vh = innerHeight;
    const [mx, my] = mapPoint(pt[0], pt[1], cfg.speed);
    const c = cutoffFor(cfg.smoothing);
    this.fx.minCutoff = this.fy.minCutoff = c;
    const x = this.fx.filter(mx * vw, t);
    const y = this.fy.filter(my * vh, t);

    // Reads first (rects), then writes (classes, transform), so the browser lays out once.
    const target = this._pick(scope, x, y);
    if (target !== this.target) {
      this.target?.classList.remove("hand-hover");
      this.target = target;
      this.since = nowMs;
      if (target) {
        target.classList.add("hand-hover");
        this.onHover?.(target);
      }
      if (target !== this.pressed) this.pressed = null;
    }
    let p = 0;
    if (target && target !== this.pressed) {
      p = Math.min(1, (nowMs - this.since) / cfg.dwell);
      if (p >= 1) {
        this.pressed = target;
        p = 0;
        this.el.classList.add("pressed");
        setTimeout(() => this.el.classList.remove("pressed"), 220);
        this._press(target);
      }
    }
    this.prog.style.strokeDashoffset = String(100 - p * 100);
    this.label.textContent = p > 0.05 ? "Hold…" : "";
    this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (!this.shown) {
      this.shown = true;
      this.el.classList.add("on");
      this.el.classList.remove("lost");
    }
  }

  _pick(scope, x, y) {
    if (this.target && this.target.isConnected && scope.contains(this.target) && !this.target.disabled) {
      const r = this.target.getBoundingClientRect();
      if (x > r.left - STICK && x < r.right + STICK && y > r.top - STICK && y < r.bottom + STICK) return this.target;
    }
    let best = null;
    let bestD = MAGNET;
    let bestArea = Infinity;
    for (const el of scope.querySelectorAll(TARGETS)) {
      if (el.closest("[hidden], [inert], .no-dwell")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      const area = r.width * r.height;
      // Inside counts as distance 0; ties go to the smaller element (a chip inside a card wins).
      if (d < bestD || (d === bestD && area < bestArea)) {
        best = el;
        bestD = d;
        bestArea = area;
      }
    }
    return best;
  }

  _press(el) {
    this.onPress?.(el);
    if (el.tagName === "SELECT") {
      // A native dropdown can't be opened by script: step to the next option instead.
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.tagName === "SUMMARY") el.parentElement.open = !el.parentElement.open;
    else el.click();
  }

  _hide(lost = false) {
    if (this.target) {
      this.target.classList.remove("hand-hover");
      this.target = null;
    }
    this.pressed = null;
    this.fx.reset();
    this.fy.reset();
    if (this.shown) {
      this.shown = false;
      this.el.classList.remove("on");
      this.el.classList.toggle("lost", lost);
    }
  }
}
