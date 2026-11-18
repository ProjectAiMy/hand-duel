// The school: walking, talking, being spotted, story scripts, and handing duels to the match flow in main.js.
// main.js gives it callbacks and tells it how each duel ended; it never touches the camera.
import { TILE, parseMap, isBlocked, doorAt, thingAt, step, spots, findPath, dirToward, opposite } from "./grid.js";
import { bakeMap, drawAlert, drawStar, drawTalk, drawTarget } from "./render.js";
import { Dialogue } from "./dialogue.js";
import { ScriptRunner } from "./script.js";
import { Creator } from "./creator.js";
import { byId, ROSTER, TWISTS } from "../npc/roster.js";
import { loadSave, writeSave, recordDuel, beaten, exportCode, importCode, freshSave, check, STAMPS } from "../save.js";
import { normalizeAvatar, drawFrame, portraitCanvas, currentPack, DEFAULT_AVATAR } from "../art/avatar.js";

const START_MAP = "courtyard";
const STORY_FILES = ["ch0-1", "ch2-3", "ch4-5"];
const STEP_MS = 165; // player, one tile
const NPC_STEP_MS = 190;
const ALERT_MS = 750;
const TILES_TALL = 11; // about this many tiles fit the screen height
const COINS = { firstWin: 30, win: 10, loss: 5 };
const STAMP_ART = { stone: ["🪨", "Stone"], paper: ["📄", "Paper"], blade: ["⚔️", "Blade"], mirror: ["🎭", "Mirror"], final: ["👑", "Final"] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRoster = (id) => ROSTER.some((n) => n.id === id);

const KEY_DIRS = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
const ACTION_KEYS = new Set([" ", "enter", "z", "e"]);

// Kept in step with data/maps (a test checks it): everyone who can spot you and challenge you.
export const SCHOOL_CHALLENGERS = [
  "pip", "luna", "bea", "ruth", "tank", "dex", "cobble", "flint", "crane", "inkwell", "parry", "riposte", "mime", "cue", "vale", "quill",
];

class Actor {
  constructor({ x, y, face = "down", avatar }) {
    Object.assign(this, { x, y, face, avatar: normalizeAvatar(avatar), px: x * TILE, py: y * TILE, move: null, walkT: 0, alertUntil: 0 });
  }
  get busy() {
    return !!this.move;
  }
  place(x, y) {
    this.x = x;
    this.y = y;
    this.px = x * TILE;
    this.py = y * TILE;
    this.move = null;
  }
}

/** Lines someone says when you talk to them: a list, or [{ if, lines }] where the first match wins. */
function talkLines(talk, save) {
  if (!Array.isArray(talk) || !talk.length) return null;
  if (typeof talk[0] === "string") return talk;
  return talk.find((t) => check(save, t.if))?.lines || null;
}

export class School {
  /**
   * root: the #school screen.
   * hooks: { onDuel(id, opts), onExit(), sfx, playMusic(name), inputBlocked() }
   */
  constructor(root, hooks) {
    this.root = root;
    this.h = hooks;
    const $ = (sel) => root.querySelector(sel);
    this.canvas = $("canvas");
    this.g = this.canvas.getContext("2d");
    this.ui = {
      place: $("#schoolPlace"), goal: $("#schoolGoal"), stats: $("#schoolStats"), help: $("#schoolHelp"), fade: $("#schoolFade"),
      skip: $("#schoolSkip"), toast: $("#schoolToast"), stamp: $("#stampShow"),
      savePanel: $("#savePanel"), saveCode: $("#saveCode"), saveMsg: $("#saveMsg"),
      card: $("#stampCard"), cardBody: $("#stampCardBody"), credits: $("#credits"), creditsText: $("#creditsText"),
    };
    this.dialogue = new Dialogue(
      { box: $("#talk"), face: $("#talkFace"), name: $("#talkName"), trait: $("#talkTrait"), text: $("#talkText"), next: $("#talkNext"), choices: $("#talkChoices") },
      { onBlip: () => hooks.sfx?.talk?.() },
    );
    this.look = new Creator(root, { save: () => this.save, persist: () => this.persist(), sfx: hooks.sfx });
    this.runner = new ScriptRunner(this);
    this.maps = new Map();
    this.scripts = null;
    this.save = loadSave();
    this.active = false;
    this.lock = 0; // > 0 while a cutscene, an encounter or a warp runs
    this.held = []; // direction keys held, last pressed wins
    this.padDir = null;
    this.path = [];
    this.pathGoal = null; // { x, y, interact }
    this.pending = null; // the duel on the duel screen: { id, actor, result, coins, resolve }
    this.stepsSinceSave = 0;
    this.pendingEvents = false;
    this.bind();
  }

  // ---------- open / close ----------
  async open() {
    this.active = true;
    this.root.hidden = false;
    this.resize();
    if (!this.scripts) await this.loadStory();
    if (!this.map) {
      const id = this.save.map || START_MAP;
      try {
        await this.enter(id, this.save.x, this.save.y, this.save.face);
      } catch (e) {
        console.warn("school save didn't load, starting at the gate", e);
        await this.enter(START_MAP);
      }
      this.showHelp();
      this.start();
      this.runEnterEvents();
    }
    this.h.playMusic?.(this.map.music || "school");
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

  async loadStory() {
    const parts = await Promise.all(STORY_FILES.map((f) => fetch(`data/story/${f}.json`).then((r) => r.json())));
    this.scripts = Object.assign({}, ...parts);
    this.chapters = await fetch("data/story/chapters.json").then((r) => r.json());
  }

  // ---------- maps ----------
  async loadMap(id) {
    if (!this.maps.has(id)) {
      const res = await fetch(`data/maps/${id}.json`);
      if (!res.ok) throw new Error(`map ${id}: ${res.status}`);
      const map = parseMap(await res.json());
      map.allThings = map.things;
      this.maps.set(id, map);
    }
    return this.maps.get(id);
  }

  async enter(id, x = null, y = null, face = null) {
    const map = await this.loadMap(id);
    this.map = map;
    this.npcs = [];
    const sp = map.spawn;
    this.player = new Actor({ x: x ?? sp.x, y: y ?? sp.y, face: face || sp.face || "down", avatar: this.save.avatar || DEFAULT_AVATAR });
    this.refresh();
    if (isBlocked(map, this.player.x, this.player.y, this.npcs)) this.player.place(sp.x, sp.y);
    // Anyone who can already see you when you arrive waits until you step out of their sight first.
    for (const n of this.challengers()) if (this.sees(n)) n.calm = true;
    this.path = [];
    this.pathGoal = null;
    this.save.map = id;
    this.persist();
    this.renderHud();
    this.h.playMusic?.(map.music || "school");
  }

  /** Apply story flags: who is here, which doors are open, which things are out. */
  refresh() {
    const map = this.map;
    if (!map) return;
    let sig = "";
    for (const d of map.doors) {
      d.locked = !!d.to && !!d.needs && !check(this.save, d.needs);
      sig += d.locked ? 1 : 0;
    }
    if (!map.baked || map.bakedSig !== sig) {
      map.baked = bakeMap(map);
      map.bakedSig = sig;
    }
    map.things = map.allThings.filter((t) => check(this.save, t.if));
    const keep = this.npcs.filter((n) => n.spawned || check(this.save, n.if));
    const want = map.npcs.filter((o) => check(this.save, o.if) && !keep.some((n) => n.id === o.id));
    this.npcs = [...keep, ...want.map((o) => this.makeNpc(o))];
  }

  makeNpc(o, spawned = false) {
    const defId = o.as || (isRoster(o.id) ? o.id : null);
    const def = defId ? byId(defId) : null;
    const a = new Actor({ x: o.x, y: o.y, face: o.face || "down", avatar: o.avatar || def?.avatar });
    return Object.assign(a, {
      id: o.id, def, spawned, name: o.name, title: o.title, emoji: o.emoji, talk: o.talk, script: o.script, sight: o.sight, turns: o.turns,
      home: { x: o.x, y: o.y, face: o.face || "down" }, calm: false, turnAt: performance.now() + 1500 + Math.random() * 2000,
    });
  }

  runEnterEvents() {
    if (this.runner.running) return void (this.pendingEvents = true);
    const ev = this.map.events.find((e) => e.on === "enter" && check(this.save, e.if));
    if (ev) this.play(ev.script);
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
    this.runEnterEvents();
  }

  // ---------- state helpers ----------
  actors() {
    return [this.player, ...this.npcs];
  }
  actor(id) {
    return id === "player" ? this.player : this.npcs.find((n) => n.id === id) || null;
  }
  challengers() {
    return this.npcs.filter((n) => n.def && !n.talk && !n.script && !n.spawned && (n.sight ?? 4) > 0 && !beaten(this.save, n.def.id));
  }
  sees(npc) {
    return spots(this.map, npc, this.player, npc.sight ?? 4, this.npcs) > 0;
  }
  blockedFor(actor) {
    const others = this.actors().filter((a) => a !== actor);
    return (x, y) => isBlocked(this.map, x, y, others);
  }

  persist() {
    if (this.player && this.map) Object.assign(this.save, { x: this.player.x, y: this.player.y, face: this.player.face });
    writeSave(this.save);
  }

  speaker(who) {
    if (who === "you") return { name: this.save.name || "You", avatar: this.player?.avatar || this.save.avatar };
    if (who === "narrator") return { name: "", emoji: "📜" };
    const a = this.actor(who);
    if (a) {
      const d = a.def;
      return { name: a.name || d?.name || who, emoji: a.emoji || d?.emoji, trait: a.title && !d ? a.title : d?.trait, avatar: a.avatar };
    }
    if (isRoster(who)) {
      const d = byId(who);
      return { name: d.name, emoji: d.emoji, trait: d.trait, avatar: d.avatar };
    }
    return { name: who, emoji: "💬" };
  }

  say(who, lines, choices) {
    const sp = this.speaker(who);
    if (sp.avatar) sp.portrait = portraitCanvas(sp.avatar, 4);
    return this.dialogue.say(sp, lines, choices);
  }

  // ---------- movement ----------
  /** Start one step; resolves when it lands. Returns false (no step) when the way is blocked. */
  walk1(actor, dir, ms) {
    actor.face = dir;
    const [nx, ny] = step(actor.x, actor.y, dir);
    if (this.blockedFor(actor)(nx, ny)) return Promise.resolve(false);
    if (!this.active) {
      actor.place(nx, ny); // not drawing (e.g. duel screen up): just move
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      actor.move = { fx: actor.x * TILE, fy: actor.y * TILE, t0: performance.now(), ms, resolve };
      actor.x = nx; // the target tile is taken straight away, so nobody else walks into it
      actor.y = ny;
    });
  }

  /** Walk an actor to a tile (or next to the player). Gives up and jumps there if it stays blocked. */
  async walkTo(actor, target, { instant = false, adjacent = false } = {}) {
    for (let tries = 0; tries < 10; tries++) {
      if (adjacent ? Math.abs(actor.x - target.x) + Math.abs(actor.y - target.y) === 1 : actor.x === target.x && actor.y === target.y) return;
      const p = findPath(this.map, actor, target, this.blockedFor(actor), { adjacent });
      if (!p) break;
      if (instant) {
        let [x, y] = [actor.x, actor.y];
        for (const d of p) [x, y] = step(x, y, d);
        actor.face = p[p.length - 1] || actor.face;
        return actor.place(x, y);
      }
      if (!(await this.walk1(actor, p[0], NPC_STEP_MS))) await sleep(250);
      if (actor !== this.player && !this.npcs.includes(actor)) return; // left the area
    }
    if (!adjacent && !isBlocked(this.map, target.x, target.y, this.actors().filter((a) => a !== actor))) actor.place(target.x, target.y);
  }

  async walkHome(npc) {
    await this.walkTo(npc, npc.home);
    if (this.npcs.includes(npc) && npc.x === npc.home.x && npc.y === npc.home.y) npc.face = npc.home.face;
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
    this.ui.skip.hidden = !this.runner.running || this.dialogue.choosing || !!this.pending;
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
    this.walk1(p, dir, STEP_MS).then((moved) => {
      if (moved) this.arrived();
      else if (this.path.length) this.retarget(); // someone stepped into the way
      else {
        const [fx, fy] = step(p.x, p.y, dir);
        const d = doorAt(this.map, fx, fy);
        if (d && (d.locked || !d.to) && (this.held.length || this.padDir) && !this.bumped) {
          this.bumped = true; // walking into a locked door says why, once per press
          this.held = [];
          this.padDir = null;
          this.interact();
        }
      }
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
    this.bumped = false;
    const door = doorAt(this.map, p.x, p.y);
    if (door?.to && !door.locked) {
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
    if (this.lock || this.dialogue.open || this.runner.running) return;
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

  // ---------- scripts (the host interface for js/world/script.js) ----------
  async play(id) {
    const steps = this.scripts?.[id];
    if (!steps) return console.warn("no script", id);
    this.lock++;
    this.path = [];
    this.pathGoal = null;
    this.queued = null;
    try {
      await this.runner.run(steps);
    } finally {
      this.lock--;
    }
  }
  scriptEnded() {
    // The cast of a cutscene leaves with it.
    this.npcs = this.npcs.filter((n) => !n.spawned);
    this.dialogue.skipNow = false;
    this.renderHud();
    if (this.pendingEvents) {
      this.pendingEvents = false;
      setTimeout(() => this.runEnterEvents(), 0);
    }
  }
  choose(who, line, options) {
    return this.say(who, [line], options);
  }
  changed() {
    this.persist();
    this.refresh();
    this.renderHud();
  }
  spawn(s) {
    this.npcs = this.npcs.filter((n) => n.id !== s.spawn);
    const npc = this.makeNpc({ ...s, id: s.spawn, sight: 0 }, true);
    if (isBlocked(this.map, npc.x, npc.y, this.actors())) {
      const spot = this.freeNear(this.player); // someone's standing there: appear next to the player instead
      if (spot) npc.place(...spot);
    }
    this.npcs.push(npc);
  }
  freeNear(a) {
    for (let r = 1; r < 6; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = a.x + dx;
          const y = a.y + dy;
          if (!isBlocked(this.map, x, y, this.actors())) return [x, y];
        }
    return null;
  }
  despawn(id) {
    this.npcs = this.npcs.filter((n) => n.id !== id);
  }
  async walk(id, to, instant) {
    const a = this.actor(id);
    if (!a) return;
    if (to === "player") return this.walkTo(a, this.player, { instant, adjacent: true });
    return this.walkTo(a, { x: to[0], y: to[1] }, { instant });
  }
  face(id, dir, toward) {
    const a = this.actor(id);
    if (!a) return;
    const other = toward ? this.actor(toward) : null;
    a.face = (other && dirToward(a, other)) || dir || a.face;
  }
  async alert(id) {
    const a = this.actor(id);
    if (!a) return;
    a.alertUntil = performance.now() + ALERT_MS;
    this.h.sfx?.alert?.();
    await sleep(ALERT_MS);
  }
  wait(ms) {
    return sleep(ms);
  }
  async fade(dir, instant) {
    this.ui.fade.classList.toggle("on", dir === "out");
    if (!instant) await sleep(300);
  }
  async warpTo(w) {
    await this.enter(w.map, w.x, w.y, w.face);
  }
  duel(id, withId) {
    return this.duelWith(id, withId ? this.actor(withId) : null);
  }
  run(id) {
    return this.scripts?.[id] || [];
  }
  async creator() {
    await this.editLook({ title: "Photo day: your look" });
  }
  async editLook(opts) {
    await this.look.edit(opts);
    this.player.avatar = normalizeAvatar(this.save.avatar);
    this.renderHud();
  }
  async credits() {
    const lines = this.chapters?.credits || ["THE END"];
    this.ui.creditsText.innerHTML = lines.map((l, i) => (i ? `<p>${escapeHtml(l)}</p>` : `<h2>${escapeHtml(l)}</h2>`)).join("");
    this.ui.credits.hidden = false;
    this.h.sfx?.matchWin?.();
    await new Promise((r) => (this.creditsDone = r));
  }

  /** Stamps, coins and items, with a little ceremony. */
  async give(g) {
    const s = this.save;
    if (g.coins) s.coins = Math.min(99999, s.coins + g.coins);
    for (const i of g.items || []) if (!s.items.includes(i)) s.items.push(i);
    if (g.stamp && !s.stamps.includes(g.stamp)) s.stamps = STAMPS.filter((k) => k === g.stamp || s.stamps.includes(k));
    this.changed();
    if (g.stamp) {
      const [emoji, name] = STAMP_ART[g.stamp] || ["⭐", g.stamp];
      this.ui.stamp.innerHTML = `<div class="stamp-seal">${emoji}</div><b>${name} stamp!</b><span>${s.stamps.length} / 5 on your card</span>`;
      this.ui.stamp.hidden = false;
      this.h.sfx?.matchWin?.();
      await sleep(this.runner.skipping ? 900 : 2400);
      this.ui.stamp.hidden = true;
    }
    if (g.coins) this.toast(`+${g.coins} 🪙`);
  }

  toast(text) {
    const t = this.ui.toast;
    t.textContent = text;
    t.hidden = false;
    t.classList.remove("go");
    void t.offsetWidth;
    t.classList.add("go");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- duels ----------
  /** Hand a duel to main.js. Resolves true (won), false (lost) or null (left it) once you're back. */
  duelWith(id, actor = null) {
    const def = byId(id);
    return new Promise((resolve) => {
      this.pending = { id, actor, result: null, coins: 0, resolve };
      this.suspend();
      this.h.onDuel(id, {
        twist: def.twist ? TWISTS[def.twist] : null,
        avatar: actor?.avatar || def.avatar,
        playerAvatar: this.player.avatar,
        playerName: this.save.name,
        arena: this.map.arena || null,
      });
    });
  }

  /** main.js: a school duel's match ended (a rematch can end several times). */
  duelEnded(won) {
    const d = this.pending;
    if (!d) return;
    const first = won && !beaten(this.save, d.id);
    d.result = won;
    recordDuel(this.save, d.id, won);
    const c = won ? (first ? COINS.firstWin : COINS.win) : COINS.loss;
    this.save.coins = Math.min(99999, this.save.coins + c);
    d.coins += c;
    this.persist();
  }

  /** main.js: back from the duel screen. */
  async resume() {
    await this.open();
    const d = this.pending;
    this.pending = null;
    if (!d) return;
    this.refresh();
    if (d.coins) this.toast(`+${d.coins} 🪙`);
    d.resolve(d.result);
  }

  async encounter(npc, dist) {
    this.lock++;
    this.path = [];
    this.pathGoal = null;
    this.queued = null;
    try {
      npc.alertUntil = performance.now() + ALERT_MS;
      this.h.sfx?.alert?.();
      await sleep(ALERT_MS);
      for (let i = 1; i < dist; i++) if (!(await this.walk1(npc, npc.face, NPC_STEP_MS))) break;
      this.player.face = opposite(npc.face);
      await this.challenge(npc);
    } finally {
      this.lock--;
    }
  }

  async challenge(npc) {
    const n = npc.def;
    const pick = await this.say(npc.id, [n.intro, "Duel me!"], ["Duel!", "Later"]);
    if (pick === 0) return this.fight(npc);
    await this.say(npc.id, ["Fine. I'll be right here."]);
    npc.calm = true;
    this.walkHome(npc);
  }

  /** A duel with a classmate (not a story duel): their line afterwards, then they go back to their spot. */
  async fight(npc) {
    const won = await this.duelWith(npc.def.id, npc);
    if (!this.npcs.includes(npc)) return;
    npc.face = opposite(this.player.face);
    const line = won === true ? npc.def.lines.beaten : won === false ? npc.def.lines.won : "Giving up already? Come back when you're ready.";
    await this.say(npc.id, [line]);
    npc.calm = true;
    this.renderHud();
    this.walkHome(npc);
  }

  /** Space / A / tap on someone: talk to whoever or whatever is in front of you. */
  async interact() {
    if (this.lock || this.dialogue.open || this.player.busy) return;
    const [fx, fy] = step(this.player.x, this.player.y, this.player.face);
    const npc = this.npcs.find((n) => n.x === fx && n.y === fy);
    if (npc?.script) return this.talkScript(npc);
    this.lock++;
    try {
      if (npc) await this.talkTo(npc);
      else {
        const thing = thingAt(this.map, fx, fy);
        const door = doorAt(this.map, fx, fy);
        if (thing) await this.useThing(thing);
        else if (door && (door.locked || !door.to) && door.lines) await this.say("narrator", door.lines);
      }
    } finally {
      this.lock--;
    }
    this.renderHud();
  }

  async talkScript(npc) {
    if (npc.busy) return;
    npc.face = opposite(this.player.face);
    await this.play(npc.script);
    if (this.npcs.includes(npc) && !npc.turns) npc.face = npc.home.face;
  }

  async talkTo(npc) {
    if (npc.busy) return;
    npc.face = opposite(this.player.face);
    const lines = talkLines(npc.talk, this.save);
    if (lines) await this.say(npc.id, lines);
    else if (npc.def && beaten(this.save, npc.def.id)) {
      const pick = await this.say(npc.id, [npc.def.lines.beaten, "Want a rematch?"], ["Rematch!", "Not now"]);
      if (pick === 0) return this.fight(npc);
    } else if (npc.def) return this.challenge(npc);
    if (this.npcs.includes(npc) && !npc.turns) npc.face = npc.home.face;
  }

  async useThing(t) {
    if (t.script) {
      this.lock--; // play() takes its own lock
      try {
        return await this.play(t.script);
      } finally {
        this.lock++;
      }
    }
    if (t.kind === "notice") return this.say("narrator", this.boardLines());
    if (t.kind === "locker") {
      return this.editLook({ title: "Your locker", shop: true });
    }
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
      const off = () => {
        if (this.padDir === b.dataset.dir) this.padDir = null;
        this.bumped = false;
      };
      b.addEventListener("pointerdown", on);
      b.addEventListener("pointerup", off);
      b.addEventListener("pointercancel", off);
      b.addEventListener("lostpointercapture", off);
    }
    const $ = (s) => this.root.querySelector(s);
    $("#padA").addEventListener("click", () => this.action());
    $("#schoolExit").addEventListener("click", () => this.h.onExit());
    $("#schoolSaveBtn").addEventListener("click", () => this.openSavePanel());
    $("#schoolCardBtn").addEventListener("click", () => this.openCard());
    this.ui.skip.addEventListener("click", () => {
      this.runner.skip();
      this.dialogue.skipLines();
    });
    this.ui.savePanel.addEventListener("click", (e) => this.onSavePanel(e));
    this.ui.card.addEventListener("click", (e) => {
      if (e.target === this.ui.card || e.target.closest("[data-close]")) this.ui.card.hidden = true;
      if (e.target.closest("[data-look]")) {
        this.ui.card.hidden = true;
        this.editLook({ title: "Your look" });
      }
    });
    this.ui.credits.addEventListener("click", (e) => {
      if (!e.target.closest("button")) return;
      this.ui.credits.hidden = true;
      this.creditsDone?.();
    });
  }

  panelOpen() {
    return !this.ui.savePanel.hidden || !this.ui.card.hidden || !this.ui.credits.hidden || this.look.open;
  }

  inputLive() {
    return this.active && !this.root.hidden && !this.h.inputBlocked?.() && !this.panelOpen();
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (!down) {
      const d = KEY_DIRS[k];
      if (d) this.held = this.held.filter((x) => x !== d);
      if (d) this.bumped = false;
      return;
    }
    if (k === "escape" && this.active && !this.root.hidden) {
      if (!this.ui.card.hidden) return void (this.ui.card.hidden = true);
      if (!this.ui.savePanel.hidden) return void (this.ui.savePanel.hidden = true);
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
    const door = doorAt(this.map, tx, ty);
    const solidTarget = npc || thingAt(this.map, tx, ty) || (door && (door.locked || !door.to) && door.lines);
    if (solidTarget) {
      const path = findPath(this.map, p, { x: tx, y: ty }, this.blockedFor(p), { adjacent: true });
      if (!path) return;
      this.path = path;
      this.pathGoal = { x: tx, y: ty, interact: true };
      if (!path.length) this.movePlayer();
      return;
    }
    const path = findPath(this.map, p, { x: tx, y: ty }, this.blockedFor(p));
    if (!path?.length) return;
    this.path = path;
    this.pathGoal = { x: tx, y: ty, interact: false };
  }

  // ---------- stamp card ----------
  openCard() {
    const s = this.save;
    const ch = this.chapters?.chapters || [];
    const stamps = STAMPS.map((k) => {
      const [emoji, name] = STAMP_ART[k];
      const got = s.stamps.includes(k);
      return `<div class="card-stamp${got ? " got" : ""}"><span>${got ? emoji : "?"}</span><small>${name}</small></div>`;
    }).join("");
    const story = ch
      .slice(0, Math.min(s.chapter, ch.length - 1) + 1)
      .map((c) => `<details><summary>${escapeHtml(c.title)}</summary><p>${escapeHtml(c.recap)}</p></details>`)
      .reverse()
      .join("");
    const won = SCHOOL_CHALLENGERS.filter((id) => beaten(s, id)).length;
    const met = ROSTER.filter((n) => s.record[n.id]);
    const record = met.length
      ? met.map((n) => `<li><b>${n.emoji}</b> ${escapeHtml(n.name)} <span>${s.record[n.id].w}–${s.record[n.id].l}</span></li>`).join("")
      : "<li>No duels yet.</li>";
    this.ui.cardBody.innerHTML = `
      <div class="card-stamps">${stamps}</div>
      <p class="card-goal"><b>Next:</b> ${escapeHtml(this.goalText())}</p>
      <p class="card-stats">🪙 ${s.coins} coins · ★ Classmates beaten ${won} / ${SCHOOL_CHALLENGERS.length}</p>
      <h3>Story so far</h3>${story}
      <h3>Your record</h3><ul class="card-record">${record}</ul>`;
    this.ui.card.hidden = false;
  }

  goalText() {
    return this.save.goal || "Explore the school.";
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
      if (this.runner.running) return msg("Finish the scene first, then load.");
      try {
        const s = importCode(this.ui.saveCode.value);
        await this.loadFrom(s);
        msg("Loaded ✓");
        this.ui.savePanel.hidden = true;
      } catch (err) {
        msg(err.message);
      }
    } else if (b.id === "saveReset") {
      if (this.runner.running) return msg("Finish the scene first.");
      if (!this.resetArmed) {
        this.resetArmed = true;
        b.textContent = "Tap again to erase";
        return msg("This erases your school progress on this device.");
      }
      this.ui.savePanel.hidden = true;
      await this.loadFrom(freshSave());
    }
  }

  async loadFrom(s) {
    this.save = s;
    writeSave(s);
    await this.enter(s.map || START_MAP, s.x, s.y, s.face);
    this.renderHud();
    this.runEnterEvents();
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
    const fh = currentPack().frame.h;
    const list = this.actors().sort((a, b) => a.py - b.py);
    for (const a of list) {
      const walking = a.move || (a === this.player && (this.held.length || this.padDir || this.path.length));
      const frame = walking ? 1 + (Math.floor(a.walkT / 130) % 2) : 0;
      drawFrame(g, a.avatar, a.px, a.py + TILE - fh, a.face, frame);
    }
    for (const n of this.npcs) {
      if (now < n.alertUntil) drawAlert(g, n.px, n.py);
      else if (n.script && !n.spawned) drawTalk(g, n.px, n.py - 4, now);
      else if (n.talk) drawTalk(g, n.px, n.py - 4, now);
      else if (n.def && beaten(this.save, n.def.id)) drawStar(g, n.px, n.py - 4);
    }
  }

  // ---------- HUD ----------
  renderHud() {
    if (!this.map) return;
    this.ui.place.textContent = this.map.name;
    this.ui.goal.textContent = this.goalText();
    this.ui.goal.title = this.goalText();
    this.ui.stats.textContent = `🎴 ${this.save.stamps.length}/5 · 🪙 ${this.save.coins}`;
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
