import { GESTURES, GESTURE_KEYS, FOULS, GestureBuffer, classify } from "./gesture.js";
import { Tracker, CameraError } from "./tracker.js";
import { sfx, unlockAudio, setMuted, isMuted } from "./audio.js";
import { Fight, MAX_HP, ROUNDS_TO_WIN, POWERS, POWER_KEYS } from "./fight.js";
import { ARENAS, showArena, randomArena, arenaById } from "./arenas.js";
import { Net, makeRoomCode, cleanCode, sha256, nonce } from "./net.js";
import { Effects, LOOKS, DEFAULT_LOOK } from "./effects.js";
import { maskThumb } from "./masks.js";

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(
  [
    "video", "overlay", "stage", "noCam", "halfL", "halfR", "badgeL", "badgeR", "tip", "stageR", "remoteVideo",
    "cpuHand", "ring", "announcer", "result", "play", "pause", "autoNext", "arenaSelect", "switchCam", "mute",
    "menuBtn", "menu", "useCam", "status", "lobby", "lobbyChoose", "lobbyHost", "roomCode", "copyLink", "shareUrl",
    "lobbyStatus", "lobbyBack", "createRoom", "joinForm", "joinCode", "matchModal", "matchEmoji", "matchTitle",
    "matchScore", "rematch", "matchMenu", "fx", "arenaBg", "nameL", "nameR", "pipsL", "pipsR", "hpL", "hpR",
    "ghostL", "ghostR", "roundLabel", "arenaName", "manualL", "manualR",
    "look", "lookBtn", "lookSheet", "lookStatus", "lookDone", "lookMask", "lookFace", "lookBackground", "lookFilter",
  ].map((id) => [id, $(id)]),
);
const ctx2d = el.overlay.getContext("2d");

// ---------- timing (ms) ----------
const BEAT = 480; // per countdown word
const CAPTURE_BEFORE = 0; // the throw is read from "Shoot!"...
const CAPTURE_AFTER = 700; // ...until this long after; the last gesture held steady in it counts
const CAPTURE_GRACE = 500; // if a hand is in view but hasn't settled on a legal shape yet, wait up to this much longer
const NEXT_DELAY_S = 3; // pause after each throw before auto-next starts the next one
const MAX_VOIDS = 3; // auto-play pauses after this many throws in a row with no hands
const ARM_HOLD_MS = 500; // hold a power sign this long between throws to arm it
const SIGN_GAP_MS = 300; // a sign lost for less than this (tracker blink, flicker) doesn't restart the hold
const ARM_BLOCK_MS = 1200; // ...but not right after a throw, so a fouled throw doesn't arm by accident
const CPU_POWER_CHANCE = 0.25; // chance the CPU uses one of its remaining powers on a throw

const MODES = {
  cpu: { names: ["YOU", "CPU"], hands: 1 },
  local: { names: ["P1", "P2"], hands: 2 },
  online: { names: ["YOU", "RIVAL"], hands: 1 },
};
const SIDE_COLORS = ["#38d6ff", "#ff8a3d"];

// ---------- state ----------
const tracker = new Tracker(el.video);
const effects = new Effects(el.video, el.look);
const fight = new Fight();
const buffers = [new GestureBuffer(2500), new GestureBuffer(2500)];
let live = [{}, {}];
let mode = "cpu";
let cameraOn = false;
let loopStarted = false;
let flowGen = 0; // bumped to cancel any running round sequence
let busy = false;
let paused = false;
let needIntro = true;
let voidStreak = 0;
let autoTimer = null;
let collecting = false; // countdown running: manual throws are accepted
let manual = [null, null];
let pendingManual = [null, null];
let arenaId = null;
let net = null;
let exCount = 0;
let guestQueue = Promise.resolve();
let armed = [null, null]; // power-up each side has armed for its next throw
const signHold = [{}, {}]; // power sign currently held per side: { p, since, done }
let armBlockUntil = 0;

const names = () => MODES[mode].names;
const isGuest = () => mode === "online" && net && !net.isHost;

// ---------- cancellable sleeps ----------
class Cancelled extends Error {}
function sleep(ms) {
  const gen = flowGen;
  return new Promise((resolve, reject) =>
    setTimeout(() => (gen === flowGen ? resolve() : reject(new Cancelled())), ms),
  );
}
function checkAlive(gen) {
  if (gen !== flowGen) throw new Cancelled();
}
function cancelFlow() {
  flowGen++;
  busy = false;
  collecting = false;
  clearTimeout(autoTimer);
  clearAnnounce();
}
function guard(promise) {
  return promise.catch((e) => {
    if (!(e instanceof Cancelled)) console.error(e);
  });
}

// ---------- menu & camera ----------
function setStatus(msg, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("error", isError);
}

async function ensureCamera() {
  if (!el.useCam.checked) {
    cameraOn = false;
    tracker.stopCamera();
    effects.setLook(DEFAULT_LOOK);
    return;
  }
  try {
    if (!tracker.stream) {
      setStatus("Starting camera…");
      await tracker.startCamera(tracker.facingMode);
    }
    el.stage.classList.toggle("mirrored", tracker.mirrored);
    if (!tracker.landmarker) {
      setStatus("Loading hand tracker… (first time ≈ 8 MB)");
      await tracker.loadModel();
    }
    await tracker.setNumHands(MODES[mode].hands);
    cameraOn = true;
    effects.setNumFaces(MODES[mode].hands).then(() => effects.setLook(myLook));
    el.switchCam.hidden = (await tracker.cameraCount()) < 2;
    setStatus("");
    if (!loopStarted) {
      loopStarted = true;
      requestAnimationFrame(loop);
    }
  } catch (e) {
    console.error(e);
    cameraOn = false;
    tracker.stopCamera();
    const msg =
      e instanceof CameraError ? e.message : "Couldn't load the hand tracker. Check your connection and try again.";
    el.noCam.querySelector("p").textContent = `${msg} Playing with buttons for now.`;
  }
}

async function chooseMode(m) {
  unlockAudio();
  document.querySelectorAll(".mode").forEach((b) => (b.disabled = true));
  mode = m;
  document.body.dataset.mode = m;
  el.noCam.querySelector("p").textContent = "Camera off — use the buttons or keys";
  await ensureCamera();
  document.querySelectorAll(".mode").forEach((b) => (b.disabled = false));
  applyModeUI();
  el.menu.hidden = true;
  if (m === "online") openLobby();
  else startMatch();
}

function applyModeUI() {
  document.body.dataset.mode = mode;
  el.nameL.textContent = names()[0];
  el.nameR.textContent = names()[1];
  el.noCam.hidden = cameraOn;
  el.badgeL.hidden = el.badgeR.hidden = !cameraOn;
  el.manualR.hidden = mode !== "local";
  const guest = isGuest();
  el.play.hidden = el.pause.hidden = guest;
  el.arenaSelect.disabled = guest;
  el.manualL.querySelectorAll("kbd").forEach((k, i) => (k.textContent = mode === "local" ? "ASD"[i] : "RPS"[i]));
  if (mode !== "online") {
    el.remoteVideo.srcObject = null;
    el.remoteVideo.classList.remove("live");
  }
  renderHud();
  updatePlayButton();
}

function backToMenu(message = "", isError = false) {
  cancelFlow();
  net?.close();
  net = null;
  el.matchModal.hidden = el.lobby.hidden = el.lookSheet.hidden = true;
  el.menu.hidden = false;
  setStatus(message, isError);
}

// ---------- detection loop ----------
const probe = document.createElement("canvas");
probe.width = 32;
probe.height = 24;
const probeCtx = probe.getContext("2d", { willReadFrequently: true });
let lastLightCheck = 0;
let lightStrikes = 0;

function loop(now) {
  requestAnimationFrame(loop);
  if (!cameraOn || document.hidden) return;
  let hands;
  try {
    hands = tracker.detect(now);
  } catch (e) {
    console.warn("detect failed", e);
    return;
  }
  if (!hands) return;

  const { video } = el;
  if (el.overlay.width !== video.videoWidth || el.overlay.height !== video.videoHeight) {
    el.overlay.width = video.videoWidth;
    el.overlay.height = video.videoHeight;
  }
  ctx2d.clearRect(0, 0, el.overlay.width, el.overlay.height);

  // Which hand belongs to which player: in 2-player mode, strictly by screen half,
  // so P1 can never accidentally throw for P2.
  const sides = [null, null];
  for (const h of hands) {
    const s = mode === "local" ? (h.screenX < 0.5 ? 0 : 1) : 0;
    if (!sides[s]) sides[s] = h;
  }
  const t = performance.now();
  sides.forEach((h, i) => {
    const c = h ? classify(h.world || h.landmarks) : { gesture: null, foul: null, confidence: 0 };
    live[i] = { ...c, visible: !!h, edge: h ? nearEdge(h.landmarks) : false };
    buffers[i].push(c.gesture, t, c.foul);
    const signing = trackSign(i, c.power, t);
    live[i].signing = signing;
    const color = signing
      ? "#b57bff"
      : c.foul
        ? "#ff5d73"
        : mode === "local"
          ? SIDE_COLORS[i]
          : c.gesture
            ? "#3ee08f"
            : "#ffcc33";
    if (h) drawHand(h.landmarks, color);
  });
  updateBadges();
  if (t - lastLightCheck > 1200) {
    lastLightCheck = t;
    checkLight();
  }
}

// ---------- power-ups ----------
/** Side `i` may arm power `p` now: between throws, in a live round, and not used yet this round. */
function canArm(i, p) {
  if (i === 1 && mode !== "local") return false;
  if (!el.menu.hidden || !el.lobby.hidden || !el.matchModal.hidden) return false;
  if (collecting || fight.matchWinner !== null || fight.roundWinner !== null) return false;
  return fight.canUse(i, p);
}

/** Follow a held power sign; arm it once held for ARM_HOLD_MS. Returns the sign being held, if armable. */
function trackSign(i, p, t) {
  const h = signHold[i];
  const ok = (q) => q && t >= armBlockUntil && canArm(i, q);
  // Brief dropouts or a frame read as another shape don't restart the hold.
  const blip = h.p && h.p !== p && t - h.seen < SIGN_GAP_MS && ok(h.p);
  if (blip) return h.p;
  if (!ok(p)) {
    signHold[i] = {};
    return null;
  }
  if (h.p !== p) signHold[i] = { p, since: t, seen: t, done: false };
  else {
    h.seen = t;
    if (!h.done && t - h.since >= ARM_HOLD_MS) {
      h.done = true;
      if (armed[i] !== p) setArmed(i, p);
    }
  }
  return p;
}

function setArmed(i, p) {
  armed[i] = p;
  if (p) sfx.arm();
  renderPowers();
}

/** Button / key: arm a power, or disarm it if it's already armed. */
function toggleArm(i, p) {
  unlockAudio();
  if (armed[i] === p) return setArmed(i, null);
  if (canArm(i, p)) setArmed(i, p);
}

/** CPU: sometimes spends one of its remaining powers. */
function cpuPower() {
  const left = POWER_KEYS.filter((k) => fight.canUse(1, k));
  if (!left.length || Math.random() >= CPU_POWER_CHANCE) return null;
  return left[Math.floor(Math.random() * left.length)];
}

/** Power chips on each fighter's corner: held, armed (own side only) or not held (dimmed). */
const powerBars = [document.createElement("div"), document.createElement("div")];
powerBars.forEach((bar, i) => {
  bar.className = "powers";
  bar.innerHTML = POWER_KEYS.map(
    (k) =>
      `<button type="button" data-power="${k}">` +
      `${POWERS[k].emoji}<span>${POWERS[k].label}</span></button>`,
  ).join("");
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-power]");
    if (b) toggleArm(i, b.dataset.power);
  });
});

function renderPowers() {
  const mine = (i) => i === 0 || mode === "local";
  powerBars.forEach((bar, i) => {
    const home = i === 0 ? el.halfL : mode === "local" ? el.halfR : el.stageR;
    if (bar.parentElement !== home) home.appendChild(bar);
    bar.classList.toggle("theirs", !mine(i));
    if (armed[i] && !fight.canUse(i, armed[i])) armed[i] = null;
    bar.querySelectorAll("button").forEach((b) => {
      const k = b.dataset.power;
      const has = fight.canUse(i, k);
      b.disabled = !mine(i) || !has;
      b.classList.toggle("off", !has);
      b.classList.toggle("armed", mine(i) && armed[i] === k);
      const P = POWERS[k];
      b.title = `${P.label} (${P.sign}): ${P.desc}. ${has ? (mine(i) ? "Hold the sign or tap to arm." : "Ready.") : P.earn + "."}`;
    });
  });
}

function nearEdge(lm) {
  return lm.some((p) => p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98);
}

function drawHand(lm, color) {
  const w = el.overlay.width;
  const h = el.overlay.height;
  ctx2d.lineWidth = Math.max(2, w / 220);
  ctx2d.strokeStyle = color;
  ctx2d.lineCap = "round";
  for (const { start, end } of tracker.connections) {
    ctx2d.beginPath();
    ctx2d.moveTo(lm[start].x * w, lm[start].y * h);
    ctx2d.lineTo(lm[end].x * w, lm[end].y * h);
    ctx2d.stroke();
  }
  ctx2d.fillStyle = "#fff";
  const r = Math.max(3, w / 180);
  for (const p of lm) {
    ctx2d.beginPath();
    ctx2d.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx2d.fill();
  }
}

function updateBadges() {
  [el.badgeL, el.badgeR].forEach((badge, i) => {
    const l = live[i];
    let text = "No hand";
    let cls = "";
    if (l.signing) {
      // Before the gesture check: thumbs up is also a rock shape.
      const p = POWERS[l.signing];
      text = armed[i] === l.signing ? `${p.emoji} ${p.label} armed!` : `${p.emoji} Hold to arm ${p.label}…`;
      cls = "power";
    } else if (l.gesture) {
      text = `${GESTURES[l.gesture].emoji} ${GESTURES[l.gesture].label}`;
      cls = "found";
    } else if (l.foul) {
      text = `🚫 ${FOULS[l.foul].label}: ${FOULS[l.foul].hint}`;
      cls = "foul";
    } else if (l.visible && l.edge) {
      text = "Hand at the edge — move it in";
      cls = "warn";
    } else if (l.visible) text = "Hand found — make a shape";
    badge.textContent = text;
    badge.className = `detect-badge ${cls}`;
  });
}

/** Spot the two lighting problems that hurt tracking most: too dark, and a bright window behind. */
function checkLight() {
  if (el.video.readyState < 2) return;
  probeCtx.drawImage(el.video, 0, 0, 32, 24);
  const d = probeCtx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  let center = 0;
  let centerN = 0;
  const blocks = new Array(16).fill(0);
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l;
      blocks[Math.floor(y / 6) * 4 + Math.floor(x / 8)] += l / 48;
      if (x >= 10 && x < 22 && y >= 6 && y < 18) {
        center += l;
        centerN++;
      }
    }
  const avg = sum / 768;
  const c = center / centerN;
  const brightest = Math.max(...blocks);
  let tip = "";
  if (avg < 55) tip = "💡 Too dark — turn on a light in front of you";
  else if (brightest > 200 && c < brightest * 0.5) tip = "💡 Bright light behind you — face the window or lamp instead";
  lightStrikes = tip ? lightStrikes + 1 : 0;
  el.tip.hidden = lightStrikes < 3;
  if (tip) el.tip.textContent = tip;
}

// ---------- HUD ----------
function renderHud() {
  [
    [el.hpL, el.ghostL, el.pipsL],
    [el.hpR, el.ghostR, el.pipsR],
  ].forEach(([fill, ghost, pips], i) => {
    const pct = (fight.hp[i] / MAX_HP) * 100;
    fill.style.width = ghost.style.width = `${pct}%`;
    fill.classList.toggle("low", pct > 0 && pct <= 30);
    pips.innerHTML = Array.from(
      { length: ROUNDS_TO_WIN },
      (_, k) => `<i class="${k < fight.roundWins[i] ? "on" : ""}"></i>`,
    ).join("");
  });
  const last = fight.roundWins[0] === ROUNDS_TO_WIN - 1 && fight.roundWins[1] === ROUNDS_TO_WIN - 1;
  el.roundLabel.textContent = last ? "FINAL ROUND" : `ROUND ${fight.round}`;
  renderPowers();
}

function announce(text, cls = "", anim = "pop") {
  el.announcer.className = "announcer";
  void el.announcer.offsetWidth; // restart the animation
  el.announcer.className = `announcer ${cls} ${anim}`;
  el.announcer.textContent = text;
}
function clearAnnounce() {
  el.announcer.textContent = "";
}

function setResult(text, cls = "") {
  el.result.textContent = text;
  el.result.className = `result ${cls}`;
}

function updatePlayButton() {
  const auto = el.autoNext.checked && !paused;
  el.play.disabled = busy || !el.matchModal.hidden;
  el.play.textContent = busy ? (auto ? "Auto ▶" : "…") : needIntro && fight.round === 1 ? "Fight!" : "Next throw";
  el.pause.classList.toggle("on", paused);
  el.pause.textContent = paused ? "▶" : "⏸";
  el.pause.title = paused ? "Resume auto-play (Esc)" : "Pause auto-play (Esc)";
}

// ---------- arenas ----------
function applyArena(id) {
  const a = showArena(el.arenaBg, id);
  arenaId = a.id;
  el.arenaName.textContent = a.name;
}
function nextArena() {
  const v = el.arenaSelect.value;
  return v === "random" ? randomArena(arenaId) : v;
}

// ---------- the fight flow ----------
/** Element where a side's feedback (throw, damage, flash) appears. */
function sideEl(i) {
  if (mode === "local") return i === 0 ? el.halfL : el.halfR;
  return i === 0 ? el.halfL : el.stageR;
}

function resetThrowVisuals() {
  document.querySelectorAll(".throw-badge, .dmg, .power-pop").forEach((n) => n.remove());
  el.cpuHand.textContent = "✊";
  el.cpuHand.classList.remove("reveal", "pump");
  document.querySelectorAll(".manual").forEach((g) => g.classList.remove("locked"));
  document.querySelectorAll(".manual button").forEach((b) => b.classList.remove("locked"));
}

function startMatch() {
  cancelFlow();
  fight.newMatch();
  armed = [null, null];
  needIntro = true;
  voidStreak = 0;
  paused = false;
  exCount = 0;
  el.matchModal.hidden = true;
  resetThrowVisuals();
  renderHud();
  setResult(isGuest() ? "Waiting for the host to start…" : "");
  updatePlayButton();
  if (isGuest()) return;
  if (mode === "online") net.send({ t: "rematch" });
  hostTurn();
}

async function roundIntro(arena) {
  applyArena(arena);
  resetThrowVisuals();
  renderHud();
  setResult("");
  const last = el.roundLabel.textContent === "FINAL ROUND";
  announce(last ? "Final round" : `Round ${fight.round}`, "gold");
  sfx.round();
  await sleep(1100);
  announce("Fight!", "red", "slam");
  sfx.fight();
  await sleep(750);
  clearAnnounce();
}

/** Countdown, then read each player's throw. */
async function countdown() {
  manual = [...pendingManual];
  pendingManual = [null, null];
  collecting = true;
  if (mode === "cpu") el.cpuHand.classList.add("pump");
  const words = ["Rock", "Paper", "Scissors"];
  for (let i = 0; i < words.length; i++) {
    announce(words[i], "small");
    sfx.tick(i);
    await sleep(BEAT);
  }
  announce("Shoot!", "small gold");
  sfx.shoot();
  const shootAt = performance.now();
  const sidesInPlay = mode === "local" ? [0, 1] : [0];
  const camSides = () => (cameraOn ? sidesInPlay.filter((i) => !manual[i]) : []);
  await sleep(camSides().length ? CAPTURE_AFTER : 150);
  // Grace: a hand that's in view but still forming its shape (or showing a foul it may fix)
  // gets a little longer, so a slightly late or slow-to-track throw still counts.
  const unsettled = () =>
    camSides().some((i) => live[i].visible && !buffers[i].hasSettled(shootAt - CAPTURE_BEFORE, performance.now()));
  while (unsettled() && performance.now() - shootAt < CAPTURE_AFTER + CAPTURE_GRACE) await sleep(60);
  const endAt = performance.now();
  collecting = false;
  armBlockUntil = endAt + ARM_BLOCK_MS;
  el.cpuHand.classList.remove("pump");
  const read = (i) => {
    if (manual[i]) return { gesture: manual[i], foul: null };
    return cameraOn ? buffers[i].read(shootAt - CAPTURE_BEFORE, endAt) : { gesture: null, foul: null };
  };
  const r0 = read(0);
  const r1 = mode === "local" ? read(1) : { gesture: null, foul: null };
  return { throws: [r0.gesture, r1.gesture], fouls: [r0.foul, r1.foul] };
}

/** One full throw. Returns 'next' | 'round' | 'match'. */
async function turn(intro, ex) {
  const gen = flowGen;
  if (intro) await roundIntro(intro);
  resetThrowVisuals();
  setResult("");
  const { throws, fouls } = await countdown();
  let [a, b] = throws;
  let note = "";
  const pw = [armed[0], mode === "local" ? armed[1] : null]; // locked in at "Shoot!"

  if (mode === "cpu") {
    if (!a) {
      clearAnnounce();
      if (fouls[0]) {
        // A shape was seen, just not a legal one: say what, and replay the throw.
        announce("Foul!", "small red");
        throwBadge(0, null, fouls[0]);
        setResult(`${FOULS[fouls[0]].label}? ${FOULS[fouls[0]].hint}. Throw again!`, "lose");
        voidStreak = 0;
      } else {
        setResult("Didn't catch your hand — hold it up on “Shoot!”");
        voidStreak++;
      }
      sfx.miss();
      await holdBeforeNext();
      return "next";
    }
    b = cpuPick();
    pw[1] = cpuPower();
  } else if (mode === "online") {
    announce("…", "small");
    const res = await exchangeOnline(ex, a, fouls[0], pw[0]);
    checkAlive(gen);
    if (res.timeout) {
      clearAnnounce();
      setResult("Connection hiccup — replaying the throw");
      await holdBeforeNext();
      return "next";
    }
    b = res.gesture;
    fouls[1] = res.foul;
    pw[1] = res.power;
    if (res.cheat) note = " (opponent's throw didn't verify)";
  }

  let ev;
  try {
    ev = fight.exchange(a, b, pw);
  } catch {
    ev = { result: "void", used: [null, null] };
  }
  ev.used.forEach((p, i) => p && armed[i] === p && (armed[i] = null));
  if (mode === "online" && !net.isHost) {
    // The host's state is the source of truth; fixes any drift after a network hiccup.
    const s = await receive(`state:${ex}`, 4000);
    checkAlive(gen);
    if (s) {
      fight.restore(s.fight, true);
      if (armed[0] && !fight.canUse(0, armed[0])) armed[0] = null;
    }
  } else if (mode === "online") {
    net.send({ t: "state", ex, fight: fight.snapshot() });
  }

  await present(a, b, ev, note, fouls);
  if (ev.ko) return koSequence(ev);
  await holdBeforeNext();
  return "next";
}

/**
 * After a throw: with auto-next on, wait NEXT_DELAY_S seconds and count down on the button.
 * With auto-next off the player starts the next throw themselves, so only a short beat.
 * Pausing (Esc) mid-countdown stops it straight away.
 */
async function holdBeforeNext() {
  const autoOn = () => isGuest() || (el.autoNext.checked && !paused);
  if (!autoOn()) return sleep(600);
  for (let s = NEXT_DELAY_S; s > 0; s--) {
    if (!autoOn()) return;
    el.play.textContent = `Next in ${s}…`;
    await sleep(1000);
  }
}

function throwBadge(i, g, foul = null) {
  if (mode === "cpu" && i === 1) {
    el.cpuHand.textContent = GESTURES[g].emoji;
    el.cpuHand.classList.add("reveal");
    return;
  }
  const b = document.createElement("div");
  b.className = "throw-badge";
  b.textContent = g ? GESTURES[g].emoji : foul ? "🚫" : "💤";
  if (foul) b.title = FOULS[foul].label;
  sideEl(i).appendChild(b);
}

function powerPop(i, p) {
  const n = document.createElement("div");
  n.className = "power-pop";
  n.textContent = `${POWERS[p].emoji} ${POWERS[p].label}`;
  sideEl(i).appendChild(n);
}

async function present(a, b, ev, note, fouls = [null, null]) {
  clearAnnounce();
  throwBadge(0, a, fouls[0]);
  throwBadge(1, b, fouls[1]);
  ev.used?.forEach((p, i) => p && powerPop(i, p));
  if (ev.used?.some(Boolean)) sfx.power();
  renderPowers();
  const n = names();
  const label = (g) => (g ? GESTURES[g].label : "nothing");
  const youPov = mode !== "local"; // colour results from the local player's point of view

  if (ev.result === "void") {
    if (fouls[0] || fouls[1]) {
      voidStreak = 0;
      const what = fouls.filter(Boolean).map((f) => FOULS[f].label).join(" and ");
      announce("Foul!", "small red");
      setResult(`No legal throws (${what}) — again!`);
    } else {
      voidStreak++;
      setResult("No throws seen — again!");
    }
    sfx.miss();
    return;
  }
  voidStreak = 0;
  if (ev.result === "draw") {
    announce("Clash!", "small");
    sfx.clash();
    const wasted = ev.used.some(Boolean) ? " (power-up spent)" : "";
    setResult(`Both ${label(a)} — clash!${wasted}${note}`, "draw");
    return;
  }

  const w = ev.winner;
  const wg = w === 0 ? a : b;
  const lg = w === 0 ? b : a;
  const lf = fouls[ev.loser];
  const verb = n[ev.loser] === "YOU" ? "were" : "was";
  const text = !ev.forfeit
    ? `${label(wg)} beats ${label(lg)}`
    : lf
      ? `Foul! ${n[ev.loser]} threw ${FOULS[lf].label.toLowerCase()}`
      : `${n[ev.loser]} ${verb} too slow!`;
  if (lf) announce("Foul!", "small red");
  const who = (i, you, them) => (n[i] === "YOU" ? you : `${n[i]} ${them}`);
  const x2 = ev.boosted ? " (×2 power)" : "";

  if (ev.result === "blocked") {
    announce("Blocked!", "small gold");
    sfx.clash();
    setResult(`${text} — 👍 ${who(ev.loser, "you block", "blocks")} ${ev.blocked}${x2}${note}`, youPov ? (ev.loser === 0 ? "win" : "lose") : "draw");
    renderHud();
    return;
  }

  const hurt = ev.hurt;
  const tail = ev.reversed
    ? `🤘 Reversed! ${who(hurt, "you take", "takes")} ${ev.damage}`
    : `${who(hurt, "you take", "takes")} ${ev.damage}`;
  setResult(`${text} — ${tail}${x2}${note}`, youPov ? (hurt === 1 ? "win" : "lose") : "win");

  // damage number + flash on the side that got hit
  const target = sideEl(hurt);
  const dmg = document.createElement("div");
  dmg.className = "dmg";
  const tag = ev.reversed ? "REVERSED" : ev.boosted ? "POWER ×2" : ev.combo > 1 ? `${ev.combo} HIT COMBO` : "";
  dmg.innerHTML = `−${ev.damage}${tag ? `<small>${tag}</small>` : ""}`;
  target.appendChild(dmg);
  setTimeout(() => dmg.remove(), 1100);
  target.classList.remove("hit-flash");
  void target.offsetWidth;
  target.classList.add("hit-flash");
  el.ring.classList.remove("shake");
  void el.ring.offsetWidth;
  el.ring.classList.add("shake");
  sfx.hit(ev.combo);
  const gains = (ev.ko ? [] : ev.earned || []).flatMap((list, i) =>
    list.map((p) => `${POWERS[p].emoji} ${n[i] === "YOU" ? "You" : n[i]} earned ${POWERS[p].label}!`),
  );
  if (gains.length) {
    el.result.textContent += ` · ${gains.join(" · ")}`;
    setTimeout(sfx.arm, 350);
  }
  if (ev.reversed) announce("Reversed!", "small gold");
  else if (ev.boosted) announce("Power ×2!", "small gold");
  else if (ev.combo > 1) announce(`${ev.combo} hit combo!`, "small gold");
  renderHud();
}

async function koSequence(ev) {
  await sleep(450);
  announce("K.O.", "big red", "slam");
  sfx.ko();
  renderHud();
  await sleep(1500);
  if (ev.perfect) {
    announce("Perfect!", "big gold", "slam");
    await sleep(1100);
  }
  const n = names()[ev.victor];
  announce(n === "YOU" ? "You win the round" : `${n} wins the round`, "small gold");
  await sleep(1300);
  clearAnnounce();
  if (ev.matchOver) {
    showMatchOver();
    return "match";
  }
  fight.nextRound();
  renderHud();
  return "round";
}

/** Host / single-device driver: runs a throw, then schedules the next one. */
async function hostTurn() {
  if (busy || isGuest() || fight.matchWinner !== null) return;
  busy = true;
  clearTimeout(autoTimer);
  updatePlayButton();
  try {
    const intro = needIntro ? nextArena() : null;
    needIntro = false;
    let ex;
    if (mode === "online") {
      ex = ++exCount;
      net.send({ t: "go", ex, intro });
    }
    const out = await turn(intro, ex);
    busy = false;
    if (out === "match") return updatePlayButton();
    if (out === "round") needIntro = true;
    if (voidStreak >= MAX_VOIDS && el.autoNext.checked) {
      paused = true;
      setResult("Paused — no hands seen. Press Next throw when you're ready.");
      voidStreak = 0;
    }
    updatePlayButton();
    if (el.autoNext.checked && !paused) autoTimer = setTimeout(hostTurn, 0);
  } catch (e) {
    busy = false;
    updatePlayButton();
    if (!(e instanceof Cancelled)) console.error(e);
  }
}

function cpuPick() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return GESTURE_KEYS[a[0] % 3];
}

function showMatchOver() {
  const w = fight.matchWinner;
  const n = names()[w];
  const youWon = mode !== "local" && w === 0;
  el.matchEmoji.textContent = mode === "local" ? "🏆" : youWon ? "🏆" : mode === "cpu" ? "🤖" : "😤";
  el.matchTitle.textContent = n === "YOU" ? "You win the match!" : `${n} wins the match!`;
  el.matchScore.textContent = `Rounds ${fight.roundWins[0]} – ${fight.roundWins[1]}`;
  el.rematch.disabled = isGuest();
  el.rematch.textContent = isGuest() ? "Waiting for host…" : "Rematch";
  el.matchModal.hidden = false;
  if (mode === "local" || youWon) {
    sfx.matchWin();
    confetti();
  } else sfx.matchLose();
  if (!isGuest()) el.rematch.focus();
  updatePlayButton();
}

function confetti() {
  const pieces = ["🎉", "✨", "✊", "✋", "✌️", "⭐"];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement("i");
    p.textContent = pieces[i % pieces.length];
    p.style.left = `${Math.random() * 100}vw`;
    p.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    el.fx.appendChild(p);
    setTimeout(() => p.remove(), 4500);
  }
}

/** Buttons/keys: lock a throw during the countdown, or start a throw when idle. */
function throwManually(side, g) {
  unlockAudio();
  if (side === 1 && mode !== "local") return;
  if (!el.menu.hidden || !el.lobby.hidden || !el.matchModal.hidden) return;
  if (collecting) manual[side] = g;
  else pendingManual[side] = g;
  // Show it's locked in. In 2-player mode don't reveal which one to the other player.
  const group = side === 0 ? el.manualL : el.manualR;
  if (mode === "local") group.classList.add("locked");
  else group.querySelectorAll("button").forEach((b) => b.classList.toggle("locked", b.dataset.throw === g));
  if (!busy && !isGuest()) hostTurn();
}

// ---------- online ----------
const mailbox = new Map();
const waiters = new Map();
function deliver(key, val) {
  const w = waiters.get(key);
  if (w) {
    waiters.delete(key);
    w(val);
  } else mailbox.set(key, val);
}
function receive(key, ms) {
  if (mailbox.has(key)) {
    const v = mailbox.get(key);
    mailbox.delete(key);
    return Promise.resolve(v);
  }
  return new Promise((resolve) => {
    waiters.set(key, resolve);
    setTimeout(() => {
      if (waiters.get(key) === resolve) {
        waiters.delete(key);
        resolve(undefined);
      }
    }, ms);
  });
}

/** Commit-reveal: send a hash of my throw, wait for theirs, then reveal. Nobody can copy. */
async function exchangeOnline(ex, mine, myFoul = null, myPower = null) {
  const g = mine || "none";
  const p = myPower || "none"; // the power-up is committed with the throw, so nobody can react to it
  const n = nonce();
  net.send({ t: "commit", ex, hash: await sha256(`${ex}:${g}:${p}:${n}`) });
  const theirs = await receive(`commit:${ex}`, 8000);
  if (!theirs) return { timeout: true };
  // f (which foul, if any) is display-only, so it isn't part of the hash.
  net.send({ t: "reveal", ex, g, p, n, f: mine ? null : myFoul });
  const r = await receive(`reveal:${ex}`, 8000);
  if (!r) return { timeout: true };
  const valid =
    (await sha256(`${ex}:${r.g}:${r.p}:${r.n}`)) === theirs.hash &&
    (r.g === "none" || Object.hasOwn(GESTURES, r.g)) &&
    (r.p === "none" || Object.hasOwn(POWERS, r.p));
  const gesture = valid && r.g !== "none" ? r.g : null;
  const power = valid && r.p !== "none" ? r.p : null;
  return { gesture, power, foul: !gesture && Object.hasOwn(FOULS, r.f ?? "") ? r.f : null, cheat: !valid };
}

function onNetMessage(m) {
  if (!m || typeof m !== "object") return;
  switch (m.t) {
    case "commit":
    case "reveal":
    case "state":
      deliver(`${m.t}:${m.ex}`, m);
      break;
    case "hello":
      $("remoteWaiting").textContent = m.cam
        ? "Connecting opponent's camera…"
        : "Your opponent is playing without a camera";
      if (net.isHost) {
        if (tracker.stream) net.startVideo();
        else net.send({ t: "you-call" });
        setTimeout(startMatch, 600);
      }
      break;
    case "you-call":
      net.startVideo();
      break;
    case "go":
      guestQueue = guestQueue.then(() => guard(guestTurn(m)));
      break;
    case "rematch":
      cancelFlow();
      guestQueue = Promise.resolve();
      mailbox.clear();
      fight.newMatch();
      armed = [null, null];
      el.matchModal.hidden = true;
      resetThrowVisuals();
      renderHud();
      setResult("");
      break;
    case "arena":
      applyArena(m.id);
      break;
    case "full":
      backToMenu("That room already has two players.", true);
      break;
  }
}

async function guestTurn(m) {
  if (fight.matchWinner !== null) return;
  busy = true;
  try {
    if (m.intro && fight.roundWinner !== null) fight.nextRound(); // catch up if we drifted
    await turn(m.intro && arenaById(m.intro).id, m.ex);
  } finally {
    busy = false;
  }
}

function newNet() {
  net?.close();
  net = new Net({
    onOpen() {
      el.lobby.hidden = true;
      mode = "online";
      net.localStream = outgoingStream();
      applyModeUI();
      setResult(net.isHost ? "Opponent joined!" : "Connected! Waiting for the host…");
      net.send({ t: "hello", cam: !!tracker.stream });
    },
    onMessage: onNetMessage,
    onStream(stream) {
      el.remoteVideo.srcObject = stream;
      el.remoteVideo.muted = true;
      el.remoteVideo.play().catch(() => {});
      el.remoteVideo.classList.add("live");
    },
    onClose(reason) {
      backToMenu(reason, true);
    },
    onError(msg) {
      if (!el.lobby.hidden) {
        el.lobbyStatus.textContent = msg;
        el.lobbyStatus.classList.add("error");
        el.lobbyChoose.hidden = false;
        el.lobbyHost.hidden = true;
        net?.close();
        net = null;
      } else backToMenu(msg, true);
    },
  });
  return net;
}

function openLobby() {
  el.lobby.hidden = false;
  el.lobbyChoose.hidden = false;
  el.lobbyHost.hidden = true;
  el.lobbyStatus.textContent = "";
  el.lobbyStatus.classList.remove("error");
  const invited = cleanCode(new URLSearchParams(location.search).get("room"));
  if (invited.length === 4) {
    el.joinCode.value = invited;
    joinRoom(invited);
  }
}

async function createRoom() {
  el.lobbyStatus.textContent = "Creating room…";
  el.lobbyStatus.classList.remove("error");
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeRoomCode();
    const n = newNet();
    try {
      await n.host(code);
      el.roomCode.textContent = code;
      el.shareUrl.textContent = `Or open ${await shareBase()} and enter the code.`;
      el.lobbyChoose.hidden = true;
      el.lobbyHost.hidden = false;
      el.lobbyStatus.textContent = "";
      return;
    } catch (e) {
      if (e?.type !== "unavailable-id") {
        el.lobbyStatus.textContent = e.message || "Couldn't create a room.";
        el.lobbyStatus.classList.add("error");
        return;
      }
    }
  }
}

async function joinRoom(code) {
  code = cleanCode(code);
  if (code.length !== 4) {
    el.lobbyStatus.textContent = "Room codes are 4 characters.";
    el.lobbyStatus.classList.add("error");
    return;
  }
  el.lobbyStatus.textContent = `Joining ${code}…`;
  el.lobbyStatus.classList.remove("error");
  try {
    await newNet().join(code);
  } catch (e) {
    el.lobbyStatus.textContent = e.message || "Couldn't join.";
    el.lobbyStatus.classList.add("error");
  }
}

/** Base URL for invite links. On localhost, use the dev server's wifi HTTPS address instead. */
let lanBase;
async function shareBase() {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (local && lanBase === undefined) {
    lanBase = await fetch("/lan.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.url?.replace(/\/$/, "") + location.pathname)
      .catch(() => null);
    if (!lanBase?.startsWith("https://")) lanBase = null;
  }
  return (local && lanBase) || `${location.origin}${location.pathname}`;
}

// ---------- events ----------
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => chooseMode(b.dataset.mode)));
el.play.addEventListener("click", () => {
  unlockAudio();
  paused = false;
  hostTurn();
});
el.pause.addEventListener("click", togglePause);
el.rematch.addEventListener("click", startMatch);
el.matchMenu.addEventListener("click", () => backToMenu());
el.menuBtn.addEventListener("click", () => backToMenu());
el.lobbyBack.addEventListener("click", () => backToMenu());
el.createRoom.addEventListener("click", createRoom);
el.joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  joinRoom(el.joinCode.value);
});
el.copyLink.addEventListener("click", async () => {
  const url = `${await shareBase()}?room=${el.roomCode.textContent}`;
  try {
    await navigator.clipboard.writeText(url);
    el.copyLink.textContent = "Link copied ✓";
  } catch {
    el.copyLink.textContent = url;
  }
});
document.querySelectorAll("[data-throw]").forEach((b) =>
  b.addEventListener("click", () => throwManually(Number(b.dataset.side), b.dataset.throw)),
);
el.autoNext.addEventListener("change", () => {
  paused = false;
  updatePlayButton();
  if (el.autoNext.checked && !busy && el.menu.hidden && fight.matchWinner === null && !needIntro) hostTurn();
});
el.arenaSelect.addEventListener("change", () => {
  const id = el.arenaSelect.value === "random" ? randomArena(arenaId) : el.arenaSelect.value;
  applyArena(id);
  if (mode === "online" && net?.isHost) net.send({ t: "arena", id });
});
el.mute.addEventListener("click", () => {
  setMuted(!isMuted());
  el.mute.textContent = isMuted() ? "🔇" : "🔊";
});
el.switchCam.addEventListener("click", async () => {
  try {
    await tracker.startCamera(tracker.facingMode === "user" ? "environment" : "user");
    el.stage.classList.toggle("mirrored", tracker.mirrored);
    net?.replaceVideoTrack(outgoingStream());
  } catch (e) {
    setResult(e.message, "lose");
  }
});

// ---------- your look (video effects) ----------
let myLook = { ...DEFAULT_LOOK };
try {
  myLook = { ...myLook, ...JSON.parse(localStorage.getItem("handduel-look") || "{}") };
} catch {
  /* storage blocked: start plain */
}

/** What an online opponent sees: the styled canvas when a look is on, else the raw camera. */
function outgoingStream() {
  return (effects.active && effects.stream) || tracker.stream;
}
effects.onActiveChange = () => {
  if (net) net.replaceVideoTrack(outgoingStream());
};
effects.onStatus = (msg, isError = false) => {
  el.lookStatus.textContent = msg;
  el.lookStatus.classList.toggle("error", isError);
};

const LOOK_ROWS = { mask: el.lookMask, face: el.lookFace, background: el.lookBackground, filter: el.lookFilter };
function buildLookPicker() {
  for (const [cat, row] of Object.entries(LOOK_ROWS)) {
    row.innerHTML = LOOKS[cat]
      .map((it) => {
        let icon = "";
        if (cat === "face") icon = `<i>${it.emoji}</i>`;
        else if (cat === "mask")
          icon =
            it.id === "none"
              ? `<i class="swatch">∅</i>`
              : `<i class="swatch thumb" style="background-image:url(${maskThumb(it.id)})"></i>`;
        else if (cat === "background") {
          const bg = it.stops
            ? `linear-gradient(${it.stops.join(",")})`
            : it.id === "blur"
              ? "radial-gradient(circle, #ccd 0 30%, #667 70%)"
              : "transparent";
          icon = `<i class="swatch" style="background:${bg}">${it.id === "none" ? "∅" : ""}</i>`;
        } else icon = `<i class="swatch tint" style="filter:${it.css}">${it.id === "none" ? "∅" : ""}</i>`;
        return `<button type="button" data-cat="${cat}" data-id="${it.id}">${icon}<span>${it.label}</span></button>`;
      })
      .join("");
  }
  markLook();
}
function markLook() {
  for (const [cat, row] of Object.entries(LOOK_ROWS))
    row.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.id === myLook[cat]));
}
function chooseLook(cat, id) {
  myLook = { ...myLook, [cat]: id };
  try {
    localStorage.setItem("handduel-look", JSON.stringify(myLook));
  } catch {
    /* not saved; still applies now */
  }
  markLook();
  if (cameraOn) effects.setLook(myLook);
}
function toggleLookSheet(open = el.lookSheet.hidden) {
  el.lookSheet.hidden = !open;
  if (open && !cameraOn) effects.onStatus("Turn on the camera (main menu) to see your look.");
  else if (open) effects.onStatus("");
}
buildLookPicker();
el.lookSheet.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (b) chooseLook(b.dataset.cat, b.dataset.id);
});
el.lookBtn.addEventListener("click", () => toggleLookSheet());
el.lookDone.addEventListener("click", () => toggleLookSheet(false));

function togglePause() {
  if (isGuest()) return;
  paused = !paused;
  clearTimeout(autoTimer);
  if (!paused && !busy && el.autoNext.checked) hostTurn();
  updatePlayButton();
}

// Solo/online: R P S (or 1 2 3). Two players on one keyboard: P1 A S D, P2 J K L.
const SOLO_KEYS = { r: "rock", p: "paper", s: "scissors", 1: "rock", 2: "paper", 3: "scissors" };
const DUO_KEYS = {
  a: [0, "rock"], s: [0, "paper"], d: [0, "scissors"],
  j: [1, "rock"], k: [1, "paper"], l: [1, "scissors"],
};
const keyThrow = (k) => (mode === "local" ? DUO_KEYS[k] : SOLO_KEYS[k] && [0, SOLO_KEYS[k]]);
// Power-ups: Q W E (P2 in 2-player mode: U I O) for power, reverse, shield.
const POWER_KEYMAP = { q: [0, 0], w: [0, 1], e: [0, 2], u: [1, 0], i: [1, 1], o: [1, 2] };
const keyPower = (k) => {
  const m = POWER_KEYMAP[k];
  return m && (m[0] === 0 || mode === "local") ? [m[0], POWER_KEYS[m[1]]] : null;
};
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey || !el.menu.hidden || !el.lobby.hidden) return;
  const k = e.key.toLowerCase();
  if (!el.matchModal.hidden) {
    if ((k === "enter" || k === " ") && !isGuest()) {
      e.preventDefault();
      startMatch();
    }
    return;
  }
  if (k === " " || k === "enter") {
    e.preventDefault();
    paused = false;
    hostTurn();
  } else if (k === "escape") {
    if (!el.lookSheet.hidden) toggleLookSheet(false);
    else togglePause();
  }
  else if (k === "m") el.mute.click();
  else if (keyThrow(k)) throwManually(...keyThrow(k));
  else if (keyPower(k)) toggleArm(...keyPower(k));
});

// Free the camera while the page is in the background on mobile; resume on return.
document.addEventListener("visibilitychange", async () => {
  if (!cameraOn) return;
  if (document.hidden) {
    if (mode !== "online") tracker.stopCamera(); // keep sending video to an online opponent
  } else if (!tracker.stream) {
    try {
      await tracker.startCamera(tracker.facingMode);
    } catch (e) {
      setResult(e.message, "lose");
    }
  }
});

// ---------- boot ----------
for (const a of ARENAS) el.arenaSelect.add(new Option(a.name, a.id));
applyArena(randomArena());
renderHud();
updatePlayButton();

const invite = cleanCode(new URLSearchParams(location.search).get("room"));
if (invite.length === 4) setStatus(`You're invited to room ${invite} — tap Online to join.`);
if (!window.isSecureContext) {
  setStatus("This page isn't on HTTPS, so the camera is blocked. Use buttons, or open it via https:// or localhost.", true);
}
navigator.permissions
  ?.query({ name: "camera" })
  .then((p) => {
    const warn = () =>
      p.state === "denied" &&
      setStatus("Your browser is blocking the camera for this site, so it won't ask. Click the camera / lock icon in the address bar, set Camera to Allow, and reload.", true);
    warn();
    p.onchange = () => (p.state === "denied" ? warn() : setStatus(""));
  })
  .catch(() => {});
