// Story engine: runs event scripts written as data (data/story/*.json). A script is a list of steps:
//   { say: who, lines: [...] }                   dialogue (who: someone on the map, a roster id, "you" or "narrator")
//   { choose: who, line, options: [...], then: [[steps], [steps]] }
//   { if: cond, then: [...], else: [...] }        cond as in save.check (flags, "beat:id", "stamp:x", "chapter>=n")
//   { spawn: id, as?, x, y, face, avatar?, name?, emoji?, title? }   { despawn: id }
//   { walk: id, to: [x, y] | "player" }   { face: id, dir | toward }   { alert: id }
//   { duel: rosterId, with?: actorId, win: [...], lose: [...] }       a camera duel (quitting runs neither)
//   { flag: name } { unflag: name } { give: { stamp?, coins?, items? } } { chapter: n, goal }
//   { creator: true } { wait: ms } { fade: "out" | "in" } { warp: { map, x, y, face } } { credits: true } { run: scriptId }
// The runner only talks to its host (the school map), so it can be tested without a browser.
import { check } from "../save.js";

export class ScriptRunner {
  /** host: see the methods called below (implemented by School). */
  constructor(host) {
    this.host = host;
    this.skipping = false;
    this.running = false;
  }

  async run(steps) {
    this.running = true;
    this.skipping = false;
    try {
      await this.steps(steps);
    } finally {
      this.running = false;
      this.skipping = false;
      this.host.scriptEnded?.();
    }
  }

  /** Skip the rest of the cutscene: walks jump, waits and lines vanish. Choices and duels still happen. */
  skip() {
    if (this.running) this.skipping = true;
  }

  async steps(list = []) {
    for (const s of list) if ((await this.step(s)) === "stop") return "stop";
  }

  async step(s) {
    const h = this.host;
    const save = h.save;
    if ("if" in s) return this.steps(check(save, s.if) ? s.then : s.else);
    if ("say" in s) return this.skipping ? undefined : h.say(s.say, s.lines);
    if ("choose" in s) {
      const i = await h.choose(s.choose, s.line, s.options);
      return this.steps(s.then?.[i] || []);
    }
    if ("duel" in s) {
      const won = await h.duel(s.duel, s.with);
      this.skipping = false; // after a duel, the scene plays normally again
      if (won === true) return this.steps(s.win);
      if (won === false) return this.steps(s.lose);
      return "stop"; // left the duel: the scene ends, and starts again from the top next time
    }
    if ("flag" in s) {
      save.flags[s.flag] = true;
      return h.changed();
    }
    if ("unflag" in s) {
      delete save.flags[s.unflag];
      return h.changed();
    }
    if ("give" in s) return h.give(s.give);
    if ("chapter" in s) {
      save.chapter = Math.max(save.chapter, s.chapter);
      if (s.goal) save.goal = s.goal;
      return h.changed();
    }
    if ("spawn" in s) return h.spawn(s);
    if ("despawn" in s) return h.despawn(s.despawn);
    if ("walk" in s) return h.walk(s.walk, s.to, this.skipping);
    if ("face" in s) return h.face(s.face, s.dir, s.toward);
    if ("alert" in s) return this.skipping ? undefined : h.alert(s.alert);
    if ("wait" in s) return this.skipping ? undefined : h.wait(s.wait);
    if ("fade" in s) return h.fade(s.fade, this.skipping);
    if ("warp" in s) return h.warpTo(s.warp);
    if ("run" in s) return this.steps(h.run(s.run));
    if ("creator" in s) return h.creator();
    if ("credits" in s) return h.credits();
    console.warn("unknown script step", s);
  }
}

/** Check scripts for unknown steps and missing references (used by tests). */
export function validateScripts(scripts, { rosterIds = [], mapActors = {} } = {}) {
  const KNOWN = ["run", "if", "say", "choose", "duel", "flag", "unflag", "give", "chapter", "spawn", "despawn", "walk", "face", "alert", "wait", "fade", "warp", "creator", "credits"];
  const errs = [];
  const walk = (list, where) =>
    (list || []).forEach((s, i) => {
      const k = KNOWN.find((x) => x in s);
      const at = `${where}[${i}]`;
      if (!k) return errs.push(`${at}: unknown step ${JSON.stringify(s)}`);
      if (k === "if") walk(s.then, `${at}.then`), walk(s.else, `${at}.else`);
      if (k === "choose") {
        if (!Array.isArray(s.options) || s.options.length < 2) errs.push(`${at}: choose needs 2+ options`);
        (s.then || []).forEach((b, j) => walk(b, `${at}.then[${j}]`));
      }
      if (k === "duel") {
        if (!rosterIds.includes(s.duel)) errs.push(`${at}: unknown duel opponent ${s.duel}`);
        walk(s.win, `${at}.win`), walk(s.lose, `${at}.lose`);
      }
      if (k === "say" && !Array.isArray(s.lines)) errs.push(`${at}: say needs lines`);
    });
  for (const [id, list] of Object.entries(scripts)) walk(list, id);
  return errs;
}
