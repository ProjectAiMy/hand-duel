// The school map: walking, talking, being spotted, and handing duels to the match flow in main.js.
// main.js gives it callbacks and tells it how each duel ended; it never touches the camera.
import { TILE, DIRS, parseMap, isBlocked, doorAt, thingAt, step, spots, findPath, dirToward, opposite } from "./grid.js";
import { bakeMap, drawActor, drawAlert, drawStar, drawTalk, drawTarget } from "./render.js";
import { Dialogue } from "./dialogue.js";
import { byId, ROSTER } from "../npc/roster.js";
import { loadSave, writeSave, recordDuel, beaten, exportCode, importCode, freshSave } from "../save.js";

const START_MAP = "courtyard";
const STEP_MS = 165; // player, one tile
const NPC_STEP_MS = 190;
const ALERT_MS = 750;
const TILES_TALL = 11; // about this many tiles fit the screen height
const PLAYER_LOOK = { skin: "#f0c8a0", hair: "#2a2236", top: "#3fb6ff" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_DIRS = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
const ACTION_KEYS = new Set([" ", "enter", "z", "e"]);

class Actor {
  constructor({ x, y, face = "down", look }) {
    Object.assign(this, { x, y, face, look, px: x * TILE, py: y * TILE, move: null, walkT: 0 });
  }
  get busy() {
    return !!this.move;
  }
}

/** Speaker info for the dialogue box. */
function speakerOf(npc) {
  const n = npc.def || byId(npc.id);
  return { name: npc.name || n.name, emoji: npc.emoji || n.emoji, trait: npc.talk ? npc.title : n.trait };
}

export class School {
  /**
   * root: the #school screen. hooks: { onDuel(id), onExit(), sfx, playMusic(name), inputBlocked() }
   */
  constructor(root, hooks) {
    this.root = root;
    this.h = hooks;
    const $ = (sel) => root.querySelector(sel);
    this.canvas = $("canvas");
    this.g = this.canvas.getContext("2d");
    this.ui = {
      place: $("#schoolPlace"), goal: $("#schoolGoal"), help: $("#schoolHelp"), fade: $("#schoolFade"),
      savePanel: $("#savePanel"), saveCode: $("#saveCode"), saveMsg: $("#saveMsg"),
    };
    this.dialogue = new Dialogue(
      { box: $("#talk"), face: $("#talkFace"), name: $("#talkName"), trait: $("#talkTrait"), text: $("#talkText"), next: $("#talkNext"), choices: $("#talkChoices") },
      { onBlip: () => hooks.sfx?.talk?.() },
    );
    this.maps = new Map();
    this.save = loadSave();
    this.active = false;
    this.lock = 0; // > 0 while a cutscene, an encounter or a warp runs
    this.held = []; // direction keys held, last pressed wins
    this.padDir = null;
    this.path = [];
    this.pathGoal = null; // { x, y, interact }
    this.duel = null; // { npc, result: null | true | false }
    this.stepsSinceSave = 0;
    this.bind();
  }

  // ---------- open / close ----------
  async open() {
    this.active = true;
    this.root.hidden = false;
    this.resize();
    if (!this.map) {
      const id = this.save.map || START_MAP;
      try {
        await this.enter(id, this.save.x, this.save.y, this.save.face);
      } catch (e) {
        console.warn("school save didn't load, starting at the gate", e);
        await this.enter(START_MAP);
      }
      this.showHelp();
    }
    this.h.playMusic?.("school");
    this.renderHud();
    this.start();
  }

  /** Stop drawing (the duel screen is up, or the player left for the menu). */
  suspend() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.held = [];
    this.padDir = null;
    this.queued = null;
    this.persist();
  }

  close() {
    this.suspend();
    this.root.hidden = true;
  }

  start() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const frame = (now) => {
      if (!this.active) return;
      this.raf = requestAnimationFrame(frame);
      this.update(now);
      this.draw(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  // ---------- maps ----------
  async loadMap(id) {
    if (!this.maps.has(id)) {
      const res = await fetch(`data/maps/${id}.json`);
      if (!res.ok) throw new Error(`map ${id}: ${res.status}`);
      const map = parseMap(await res.json());
      map.baked = bakeMap(map);
      this.maps.set(id, map);
    }
    return this.maps.get(id);
  }

  async enter(id, x = null, y = null, face = null) {
    const map = await this.loadMap(id);
    this.map = map;
    const sp = map.spawn;
    const px = x ?? sp.x;
    const py = y ?? sp.y;
    this.npcs = map.npcs.map((o) => {
      const a = new Actor({ x: o.x, y: o.y, face: o.face, look: o.look });
      return Object.assign(a, o, { home: { x: o.x, y: o.y, face: o.face }, def: o.talk ? null : byId(o.id), alertUntil: 0, calm: false, turnAt: performance.now() + 1500 + Math.random() * 2000 });
    });
    const free = !isBlocked(map, px, py, this.npcs);
    this.player = new Actor({ x: free ? px : sp.x, y: free ? py : sp.y, face: face || sp.face || "down", look: PLAYER_LOOK });
    // Anyone who can already see you when you arrive waits until you step out of their sight first.
    for (const n of this.challengers()) if (this.sees(n)) n.calm = true;
    this.path = [];
    this.pathGoal = null;
    this.save.map = id;
    this.persist();
    this.renderHud();
  }

  async warp(door) {
    this.lock++;
    this.h.sfx?.door?.();
    this.ui.fade.classList.add("on");
    await sleep(220);
    try {
      await this.enter(door.to, door.tx, door.ty, door.face);
    } finally {
      this.ui.fade.classList.remove("on");
      this.lock--;
    }
  }

  // ---------- state helpers ----------
  actors() {
    return [this.player, ...this.npcs];
  }
  challengers() {
    return this.npcs.filter((n) => !n.talk && !beaten(this.save, n.id));
  }
  sees(npc) {
    return spots(this.map, npc, this.player, npc.sight ?? 4, this.npcs) > 0;
  }
  blockedFor(actor) {
    const others = this.actors().filter((a) => a !== actor);
    return (x, y) => isBlocked(this.map, x, y, others);
  }

  persist() {
    if (!this.player) return;
    Object.assign(this.save, { x: this.player.x, y: this.player.y, face: this.player.face });
    writeSave(this.save);
  }

  // ---------- movement ----------
  /** Start one step; resolves when it lands. Returns false (no step) when the way is blocked. */
  walk(actor, dir, ms) {
    actor.face = dir;
    const [nx, ny] = step(actor.x, actor.y, dir);
    if (this.blockedFor(actor)(nx, ny)) return Promise.resolve(false);
    return new Promise((resolve) => {
      actor.move = { fx: actor.x * TILE, fy: actor.y * TILE, t0: performance.now(), ms, resolve };
      actor.x = nx; // the target tile is taken straight away, so nobody else walks into it
      actor.y = ny;
    });
  }

  async walkHome(npc) {
    for (let tries = 0; tries < 12 && (npc.x !== npc.home.x || npc.y !== npc.home.y); tries++) {
      const p = findPath(this.map, npc, npc.home, this.blockedFor(npc));
      if (!p?.length) {
        await sleep(400);
        continue;
      }
      if (!(await this.walk(npc, p[0], NPC_STEP_MS))) await sleep(300);
      if (!this.npcs.includes(npc)) return; // you left the area
    }
    npc.face = npc.home.face;
  }

  update(now) {
    for (const a of this.actors()) {
      if (!a.move) continue;
      const k = Math.min(1, (now - a.move.t0) / a.move.ms);
      a.px = a.move.fx + (a.x * TILE - a.move.fx) * k;
      a.py = a.move.fy + (a.y * TILE - a.move.fy) * k;
      a.walkT += now - this.last;
      if (k >= 1) {
        const r = a.move.resolve;
        a.move = null;
        a.px = a.x * TILE;
        a.py = a.y * TILE;
        r(true);
      }
    }
    this.last = now;
    if (!this.lock && !this.dialogue.open) {
      this.lookAround(now);
      this.movePlayer();
    }
  }

  /** Some NPCs turn now and then, so their line of sight sweeps. */
  lookAround(now) {
    for (const n of this.npcs) {
      if (!n.turns || n.busy || now < n.turnAt || n.x !== n.home.x || n.y !== n.home.y) continue;
      n.turnAt = now + 1800 + Math.random() * 1800;
      n.face = n.turns[(n.turns.indexOf(n.face) + 1) % n.turns.length];
      if (!this.player.busy) this.checkSpotted();
    }
  }

  movePlayer() {
    const p = this.player;
    if (p.busy) return;
    let dir = this.padDir || this.held[this.held.length - 1] || this.queued;
    this.queued = null;
    if (dir) {
      this.path = [];
      this.pathGoal = null;
    } else if (this.path.length) dir = this.path.shift();
    else if (this.pathGoal?.interact) {
      const goal = this.pathGoal;
      this.pathGoal = null;
      p.face = dirToward(p, goal) || p.face;
      return this.interact();
    } else {
      this.pathGoal = null;
      return;
    }
    p.walkT = p.walkT || 0;
    this.walk(p, dir, STEP_MS).then((moved) => {
      if (moved) this.arrived();
      else if (this.path.length) this.retarget(); // someone stepped into the way
    });
  }

  retarget() {
    const goal = this.pathGoal;
    this.path = [];
    if (!goal) return;
    const p = findPath(this.map, this.player, goal, this.blockedFor(this.player), { adjacent: goal.interact });
    if (p) this.path = p;
    else this.pathGoal = null;
  }

  arrived() {
    const p = this.player;
    const door = doorAt(this.map, p.x, p.y);
    if (door?.to) {
      this.path = [];
      this.pathGoal = null;
      return this.warp(door);
    }
    if (++this.stepsSinceSave >= 8) {
      this.stepsSinceSave = 0;
      this.persist();
    }
    this.checkSpotted();
  }

  /** Has a challenger seen you? Also lets calm NPCs watch again once you've left their sight. */
  checkSpotted() {
    if (this.lock || this.dialogue.open) return;
    for (const n of this.challengers()) {
      if (n.busy) continue;
      const d = spots(this.map, n, this.player, n.sight ?? 4, this.npcs);
      if (!d) {
        n.calm = false;
        continue;
      }
      if (n.calm) continue;
      this.encounter(n, d);
      return;
    }
  }

  // ---------- encounters and talking ----------
  async encounter(npc, dist) {
    this.lock++;
    this.path = [];
    this.pathGoal = null;
    this.queued = null;
    try {
      npc.alertUntil = performance.now() + ALERT_MS;
      this.h.sfx?.alert?.();
      await sleep(ALERT_MS);
      for (let i = 1; i < dist; i++) if (!(await this.walk(npc, npc.face, NPC_STEP_MS))) break;
      this.player.face = opposite(npc.face);
      await this.challenge(npc);
    } finally {
      this.lock--;
    }
  }

  async challenge(npc) {
    const n = npc.def;
    const pick = await this.dialogue.say(speakerOf(npc), [n.intro, "Duel me!"], ["Duel!", "Later"]);
    if (pick === 0) return this.startDuel(npc);
    await this.dialogue.say(speakerOf(npc), ["Fine. I'll be right here."]);
    npc.calm = true;
    this.walkHome(npc);
  }

  startDuel(npc) {
    this.duel = { npc, result: null };
    this.suspend();
    this.h.onDuel(npc.id);
  }

  /** main.js: a school duel's match ended (a rematch can end several times). */
  duelEnded(won) {
    if (!this.duel) return;
    this.duel.result = won;
    recordDuel(this.save, this.duel.npc.id, won);
    this.persist();
  }

  /** main.js: back from the duel screen. */
  async resume() {
    await this.open();
    const d = this.duel;
    this.duel = null;
    if (!d) return;
    const npc = this.npcs.find((n) => n.id === d.npc.id) || d.npc;
    this.lock++;
    try {
      npc.face = opposite(this.player.face);
      const line = d.result === true ? npc.def.lines.beaten : d.result === false ? npc.def.lines.won : "Giving up already? Come back when you're ready.";
      await this.dialogue.say(speakerOf(npc), [line]);
      if (d.result === true && this.challengers().length === 0) await this.allBeaten();
    } finally {
      this.lock--;
    }
    npc.calm = true;
    this.renderHud();
    this.walkHome(npc);
  }

  async allBeaten() {
    await this.dialogue.say({ name: "Mx. Hale", emoji: "🧹", trait: "Caretaker" }, [
      "(Over the speakers) Word travels fast. You've beaten everyone in the courtyard and the corridor!",
      "The clubs will start paying attention to you now. That's a story for another day.",
    ]);
  }

  /** Space / A / tap on someone: talk to whoever or whatever is in front of you. */
  async interact() {
    if (this.lock || this.dialogue.open || this.player.busy) return;
    const [fx, fy] = step(this.player.x, this.player.y, this.player.face);
    const npc = this.npcs.find((n) => n.x === fx && n.y === fy);
    this.lock++;
    try {
      if (npc) await this.talkTo(npc);
      else {
        const thing = thingAt(this.map, fx, fy);
        const door = doorAt(this.map, fx, fy);
        if (thing) await this.useThing(thing);
        else if (door?.lines) await this.dialogue.say({ name: door.name || "Door", emoji: "🚪" }, door.lines);
      }
    } finally {
      this.lock--;
    }
    this.renderHud();
  }

  async talkTo(npc) {
    if (npc.busy) return;
    npc.face = opposite(this.player.face);
    if (npc.talk) {
      await this.dialogue.say(speakerOf(npc), npc.talk);
      this.save.flags[`met_${npc.id}`] = true;
      this.persist();
    } else if (beaten(this.save, npc.id)) {
      const pick = await this.dialogue.say(speakerOf(npc), [npc.def.lines.beaten, "Want a rematch?"], ["Rematch!", "Not now"]);
      if (pick === 0) return this.startDuel(npc);
    } else return this.challenge(npc);
    if (!npc.turns) npc.face = npc.home.face;
  }

  async useThing(t) {
    if (t.kind === "notice") return this.dialogue.say({ name: t.name, emoji: t.emoji }, this.boardLines());
    return this.dialogue.say({ name: t.name, emoji: t.emoji }, t.lines || ["…"]);
  }

  /** The notice board: your record against everyone you've duelled. */
  boardLines() {
    const met = ROSTER.filter((n) => this.save.record[n.id]);
    if (!met.length) return ["THE DUEL BOARD", "No results yet. Your name isn't on here… yet."];
    const rows = met.map((n) => {
      const r = this.save.record[n.id];
      return `${r.w ? "★" : "·"} ${n.name}: won ${r.w}, lost ${r.l}`;
    });
    const out = ["THE DUEL BOARD"];
    for (let i = 0; i < rows.length; i += 4) out.push(rows.slice(i, i + 4).join("\n"));
    return out;
  }

  // ---------- input ----------
  bind() {
    document.addEventListener("keydown", (e) => this.onKey(e, true));
    document.addEventListener("keyup", (e) => this.onKey(e, false));
    addEventListener("blur", () => (this.held = []));
    addEventListener("resize", () => this.active && this.resize());

    // Tap or click on the map: walk there, or walk up to someone/something and talk.
    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.active) return;
      if (this.dialogue.open) return this.dialogue.advance();
      if (this.lock) return;
      const r = this.canvas.getBoundingClientRect();
      const s = this.scale / (devicePixelRatio || 1);
      const tx = Math.floor(((e.clientX - r.left) / s + this.cam.x) / TILE);
      const ty = Math.floor(((e.clientY - r.top) / s + this.cam.y) / TILE);
      this.tapTo(tx, ty);
    });

    // On-screen pad for touch screens.
    for (const b of this.root.querySelectorAll("[data-dir]")) {
      const on = (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        if (this.dialogue.choosing) return this.dialogue.moveChoice(b.dataset.dir === "up" || b.dataset.dir === "left" ? -1 : 1);
        if (this.dialogue.open) return;
        this.padDir = b.dataset.dir;
      };
      const off = () => this.padDir === b.dataset.dir && (this.padDir = null);
      b.addEventListener("pointerdown", on);
      b.addEventListener("pointerup", off);
      b.addEventListener("pointercancel", off);
      b.addEventListener("lostpointercapture", off);
    }
    this.root.querySelector("#padA").addEventListener("click", () => this.action());
    this.root.querySelector("#schoolExit").addEventListener("click", () => this.h.onExit());
    this.root.querySelector("#schoolSaveBtn").addEventListener("click", () => this.openSavePanel());
    this.ui.savePanel.addEventListener("click", (e) => this.onSavePanel(e));
  }

  inputLive() {
    return this.active && !this.root.hidden && !this.h.inputBlocked?.() && this.ui.savePanel.hidden;
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (!down) {
      const d = KEY_DIRS[k];
      if (d) this.held = this.held.filter((x) => x !== d);
      return;
    }
    if (!this.inputLive() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const d = KEY_DIRS[k];
    if (d) {
      e.preventDefault();
      if (this.dialogue.choosing) return this.dialogue.moveChoice(d === "up" || d === "left" ? -1 : 1);
      if (!e.repeat && !this.held.includes(d)) this.held.push(d);
      if (this.player?.busy) this.queued = d; // tapped mid-step: take it next
      else if (!this.lock && !this.dialogue.open) this.movePlayer(); // a quick tap still takes one step
      return;
    }
    if (ACTION_KEYS.has(k)) {
      // Enter/Space on a focused choice button presses that button (the browser does it).
      if (this.dialogue.choosing && document.activeElement?.closest?.(".talk-choices")) return;
      e.preventDefault();
      if (!e.repeat) this.action();
    }
  }

  action() {
    if (!this.inputLive()) return;
    if (this.dialogue.choosing) {
      const f = document.activeElement?.closest?.(".talk-choices") ? document.activeElement : null;
      return f ? f.click() : this.dialogue.moveChoice(0);
    }
    if (this.dialogue.open) return this.dialogue.advance();
    this.interact();
  }

  tapTo(tx, ty) {
    const p = this.player;
    const npc = this.npcs.find((n) => n.x === tx && n.y === ty);
    const solidTarget = npc || thingAt(this.map, tx, ty) || doorAt(this.map, tx, ty)?.lines;
    if (solidTarget) {
      const path = findPath(this.map, p, { x: tx, y: ty }, this.blockedFor(p), { adjacent: true });
      if (!path) return;
      this.path = path;
      this.pathGoal = { x: tx, y: ty, interact: true };
      return;
    }
    const path = findPath(this.map, p, { x: tx, y: ty }, this.blockedFor(p));
    if (!path?.length) return;
    this.path = path;
    this.pathGoal = { x: tx, y: ty, interact: false };
  }

  // ---------- save panel ----------
  openSavePanel() {
    this.persist();
    this.ui.saveCode.value = exportCode(this.save);
    this.ui.saveMsg.textContent = "";
    this.resetArmed = false;
    this.root.querySelector("#saveReset").textContent = "Start over";
    this.ui.savePanel.hidden = false;
  }

  async onSavePanel(e) {
    const b = e.target.closest("button");
    if (e.target === this.ui.savePanel || b?.dataset.close !== undefined) return void (this.ui.savePanel.hidden = true);
    if (!b) return;
    const msg = (t) => (this.ui.saveMsg.textContent = t);
    if (b.id === "saveCopy") {
      try {
        await navigator.clipboard.writeText(exportCode(this.save));
        msg("Copied. Paste it on another device to carry on there.");
      } catch {
        this.ui.saveCode.select();
        msg("Select the code and copy it.");
      }
    } else if (b.id === "saveLoad") {
      try {
        const s = importCode(this.ui.saveCode.value);
        this.loadFrom(s);
        msg("Loaded ✓");
        this.ui.savePanel.hidden = true;
      } catch (err) {
        msg(err.message);
      }
    } else if (b.id === "saveReset") {
      if (!this.resetArmed) {
        this.resetArmed = true;
        b.textContent = "Tap again to erase";
        return msg("This erases your school progress on this device.");
      }
      this.loadFrom(freshSave());
      this.ui.savePanel.hidden = true;
    }
  }

  async loadFrom(s) {
    this.save = s;
    writeSave(s);
    await this.enter(s.map || START_MAP, s.x, s.y, s.face);
    this.renderHud();
  }

  // ---------- drawing ----------
  resize() {
    const dpr = devicePixelRatio || 1;
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // Whole-number scaling keeps pixels crisp; small screens still get at least 2×.
    this.scale = Math.max(2, Math.round(this.canvas.height / (TILES_TALL * TILE)));
    if (this.canvas.width / this.scale < 9 * TILE) this.scale = Math.max(2, Math.floor(this.canvas.width / (9 * TILE)));
  }

  draw(now) {
    const { g, canvas, map, scale } = this;
    if (!map) return;
    const vw = canvas.width / scale;
    const vh = canvas.height / scale;
    const mw = map.w * TILE;
    const mh = map.h * TILE;
    const focus = (v, size, total) => (total <= size ? -(size - total) / 2 : Math.max(0, Math.min(total - size, v - size / 2)));
    this.cam = {
      x: Math.round(focus(this.player.px + TILE / 2, vw, mw)),
      y: Math.round(focus(this.player.py + TILE / 2, vh, mh)),
    };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#151628";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingEnabled = false;
    g.setTransform(scale, 0, 0, scale, -this.cam.x * scale, -this.cam.y * scale);
    g.drawImage(map.baked, 0, 0);
    if (this.pathGoal && !this.pathGoal.interact) drawTarget(g, this.pathGoal.x, this.pathGoal.y, now);
    // Draw from the top of the screen down, so people lower down stand in front.
    const list = this.actors().sort((a, b) => a.py - b.py);
    for (const a of list) {
      const walking = a.move || (a === this.player && (this.held.length || this.padDir || this.path.length));
      const frame = walking ? Math.floor(a.walkT / 130) % 2 : 0;
      drawActor(g, a.px, a.py, a.face, a.look, frame);
    }
    for (const n of this.npcs) {
      if (now < n.alertUntil) drawAlert(g, n.px, n.py);
      else if (n.talk) drawTalk(g, n.px, n.py, now);
      else if (beaten(this.save, n.id)) drawStar(g, n.px, n.py);
    }
  }

  // ---------- HUD ----------
  renderHud() {
    if (!this.map) return;
    this.ui.place.textContent = this.map.name;
    const won = SCHOOL_CHALLENGERS.filter((id) => beaten(this.save, id)).length;
    this.ui.goal.innerHTML = `★ <span class="goal-long">Classmates beaten: </span>${won} / ${SCHOOL_CHALLENGERS.length}<span class="goal-short"> beaten</span>`;
  }

  showHelp() {
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.ui.help.textContent = coarse
      ? "Tap where to walk, or use the pad. Tap someone to talk."
      : "Arrow keys or WASD to walk · Space to talk · or click where to go";
    this.ui.help.hidden = false;
    clearTimeout(this.helpTimer);
    this.helpTimer = setTimeout(() => (this.ui.help.hidden = true), 6000);
  }
}

// Kept in step with data/maps (a test checks it), so the goal counter knows everyone before you've visited every area.
export const SCHOOL_CHALLENGERS = ["pip", "luna", "bea", "ruth", "tank", "dex"];
