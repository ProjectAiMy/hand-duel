import { GESTURES, GESTURE_KEYS, FOULS, GestureBuffer, classify } from "./gesture.js";
import { Tracker, CameraError, QUALITY } from "./tracker.js";
import { sfx, unlockAudio, setAudio, playMusic, duckMusic } from "./audio.js";
import { Fight, MAX_HP, ROUNDS_TO_WIN, POWERS, POWER_KEYS } from "./fight.js";
import { ARENAS, showArena, randomArena, arenaById } from "./arenas.js";
import { Net, makeRoomCode, cleanCode, sha256, nonce } from "./net.js";
import { Effects, LOOKS, DEFAULT_LOOK } from "./effects.js";
import { maskThumb } from "./masks.js";
import * as S from "./settings.js";
import { HandCursor, palmPoint } from "./cursor.js";
import { createOpponent } from "./duel/opponents.js";
import { ROSTER, GROUPS } from "./npc/roster.js";
import { School } from "./world/school.js";
import { avatarCanvas } from "./art/avatar.js";

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(
  [
    "video", "overlay", "stage", "noCam", "halfL", "halfR", "badgeL", "badgeR", "tip", "stageR", "remoteVideo",
    "cpuHand", "ring", "announcer", "result", "play", "pause", "arenaSelect", "switchCam",
    "menuBtn", "menu", "status", "lobby", "lobbyChoose", "lobbyHost", "roomCode", "copyLink", "shareUrl",
    "lobbyStatus", "lobbyBack", "createRoom", "joinForm", "joinCode", "matchModal", "matchEmoji", "matchTitle",
    "matchScore", "rematch", "matchMenu", "fx", "arenaBg", "nameL", "nameR", "pipsL", "pipsR", "hpL", "hpR",
    "ghostL", "ghostR", "roundLabel", "arenaName", "manualL", "manualR",
    "look", "lookBtn", "lookSheet", "lookStatus", "lookDone", "lookMask", "lookFace", "lookBackground", "lookFilter",
    "landing", "handTest", "calibDone", "camBar", "camBtn", "startBtn", "landingStatus", "inviteNote", "calibSlot", "calibIdle", "calibStart",
    "calibPill", "chkHand", "chkDist", "chkLight", "camHelp", "camHelpIcon", "camHelpTitle", "camHelpText",
    "camHelpSteps", "camRetry", "camSkip", "howto", "howtoBtn", "retestBtn", "settingsPanel", "fsToggle", "fsRow",
    "resetSettings", "layoutSwitch", "cornerL", "cornerR", "dock", "menuTag", "dockGrab", "sheetPowers", "readDot",
    "oppTag", "oppEmoji", "oppName", "oppTrait", "oppSay", "readPanel", "rpName", "rpHist", "rpBars", "rpHint",
    "oppPicker", "oppList", "oppDifficulty", "matchOpp", "school", "oppAvatar", "twistChip", "lastThrow",
  ].map((id) => [id, $(id)]),
);
const ctx2d = el.overlay.getContext("2d");
// Phones and portrait tablets get the focus layout (same breakpoint as the phone CSS).
const compactMQ = matchMedia("(max-width: 760px), (orientation: portrait) and (max-width: 1000px)");
const compact = () => compactMQ.matches;
document.body.classList.toggle("compact", compact());


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
let wantCam = true; // the player wants the camera ("Play with buttons" on the camera help screen sets false)
let lightOk = true;
let layout = "them"; // in-game video layout: split | them (opponent big) | me (you big)
let remoteHand = null; // { b: [x0, y0, x1, y1] in their camera frame, at } sent by an online opponent

let opponent = createOpponent(S.get("opponent"), { easy: S.get("difficulty") === "easy" }); // VS CPU opponent
let planned = null; // the opponent's throw for the current countdown, decided before yours is read
let schoolDuel = null; // id of the classmate you're duelling from the school map (VS CPU otherwise)
let schoolOpts = null; // that duel's { twist, avatar, playerName, arena }
let resumeMode = null; // the game picked when the camera failed; starts once the help screen is closed
const twist = () => (mode === "cpu" && schoolDuel ? schoolOpts?.twist : null) || null;
const names = () => (mode === "cpu" ? ["YOU", (opponent.npc.short || opponent.npc.name).toUpperCase()] : MODES[mode].names);
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
  duckMusic(false);
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
  for (const s of [el.status, el.landingStatus]) {
    s.textContent = msg;
    s.classList.toggle("error", isError);
  }
}

/** Start the camera and tracker if the player wants them. Returns true when tracking is running.
 *  Calls made while one is already starting share it, so the camera is never opened twice. */
let cameraStarting = null;
function ensureCamera() {
  cameraStarting ??= startCamera().finally(() => (cameraStarting = null));
  return cameraStarting;
}
async function startCamera() {
  if (!wantCam) {
    cameraOn = false;
    tracker.stopCamera();
    effects.setLook(DEFAULT_LOOK);
    updateTrackChip();
    return false;
  }
  try {
    if (!tracker.stream) {
      setStatus("Starting camera…");
      setTrackChip("loading", "Starting camera…");
      await tracker.startCamera(tracker.facingMode);
    }
    el.stage.classList.toggle("mirrored", tracker.mirrored);
    if (!tracker.landmarker) {
      setStatus("Loading hand tracker… (first time ≈ 8 MB)");
      setTrackChip("loading", "Loading tracker…");
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
    updateTrackChip();
    return true;
  } catch (e) {
    console.error(e);
    cameraOn = false;
    tracker.stopCamera();
    setStatus("");
    updateTrackChip();
    showCamHelp(e);
    el.noCam.querySelector("p").textContent = "Camera off — use the buttons or keys";
    return false;
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
  if (!el.camHelp.hidden) return void (resumeMode = m); // camera failed: carry on with this mode after the help screen
  resumeMode = null;
  applyModeUI();
  showScreen("game");
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
  renderOpponent();
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
  applyLayout();
}

function backToMenu(message = "", isError = false) {
  cancelFlow();
  resumeMode = null;
  net?.close();
  net = null;
  remoteHand = null;
  el.matchModal.hidden = el.lobby.hidden = el.lookSheet.hidden = true;
  showScreen("menu");
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
  frameCount++;
  sides.forEach((h, i) => {
    const c = h ? classify(h.world || h.landmarks) : { gesture: null, foul: null, confidence: 0 };
    live[i] = { ...c, visible: !!h, edge: h ? nearEdge(h.landmarks) : false, box: h ? bbox(h.landmarks) : null };
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
    if (h && S.get("skeleton")) drawHand(h.landmarks, color);
  });
  updateBadges();
  if (t - lastLightCheck > 1200) {
    lastLightCheck = t;
    checkLight();
  }
  // Hand cursor: the first hand seen, as the player sees it (mirrored like the video).
  const ch = sides[0] || sides[1];
  let pt = null;
  if (ch) {
    const [px, py] = palmPoint(ch.landmarks);
    pt = [tracker.mirrored ? 1 - px : px, py];
  }
  cursor.update(pt, t);
  if (!el.handTest.hidden) updateCalibration(t);
  updateTrackChip(t);
  if (mode === "online") sendHand(t);
}

/** Normalised bounding box [x0, y0, x1, y1] of a hand, in the raw (unmirrored) camera frame. */
function bbox(lm) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return [x0, y0, x1, y1];
}

// ---------- power-ups ----------
/** Side `i` may arm power `p` now: between throws, in a live round, and not used yet this round. */
function canArm(i, p) {
  if (i === 1 && mode !== "local") return false;
  if (overlayOpen() || !el.matchModal.hidden) return false;
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
    const home = i === 0 ? (compact() && mode !== "local" ? el.sheetPowers : el.halfL) : mode === "local" ? el.halfR : el.stageR;
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
    if (i === 0) {
      // Phones: the small camera badge shows the same reading as one symbol.
      const l0 = live[0];
      el.readDot.textContent = !cameraOn ? "" : l0.signing ? POWERS[l0.signing].emoji : l0.gesture ? GESTURES[l0.gesture].emoji : l0.foul ? "🚫" : l0.visible ? "…" : "?";
      el.readDot.className = `read-dot ${cls}`;
    }
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
  lightOk = lightStrikes < 3;
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
      { length: fight.roundsToWin },
      (_, k) => `<i class="${k < fight.roundWins[i] ? "on" : ""}"></i>`,
    ).join("");
  });
  const last = fight.roundWins[0] === fight.roundsToWin - 1 && fight.roundWins[1] === fight.roundsToWin - 1;
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
  const auto = S.get("autoNext") && !paused;
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
  fight.setRules(twist()?.rules || {}); // club twists change the rules; everyone else plays the defaults
  el.oppAvatar.classList.remove("ko", "hit");
  el.lastThrow.hidden = true;
  armed = [null, null];
  needIntro = true;
  voidStreak = 0;
  paused = false;
  exCount = 0;
  el.matchModal.hidden = true;
  playMusic("fight");
  resetThrowVisuals();
  renderHud();
  setResult(isGuest() ? "Waiting for the host to start…" : "");
  updatePlayButton();
  if (isGuest()) return;
  if (mode === "online") net.send({ t: "rematch" });
  if (mode === "cpu") {
    opponent.reset();
    renderRead();
    oppSay(opponent.npc.intro, 3200);
  }
  hostTurn();
}

async function roundIntro(arena) {
  applyArena(arena);
  el.oppAvatar.classList.remove("ko");
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
  const beat = twist()?.beat || BEAT; // Snip's speed rounds count down faster
  manual = [...pendingManual];
  pendingManual = [null, null];
  collecting = true;
  duckMusic(true);
  if (mode === "cpu") {
    el.cpuHand.classList.add("pump");
    planned = opponent.plan(fight); // before your throw is read, from earlier throws only
    if (planned.tell) oppSay(planned.tell, beat * 3, "tell");
  }
  const words = ["Rock", "Paper", "Scissors"];
  for (let i = 0; i < words.length; i++) {
    announce(words[i], "small");
    sfx.tick(i);
    await sleep(beat);
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
  duckMusic(false);
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
    b = planned.gesture;
    pw[1] = opponent.power(fight);
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
  if (mode === "cpu") {
    opponent.record(b, a, ev);
    renderRead();
  }
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
  if (mode === "cpu") reactAvatar(ev, a);
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
  const autoOn = () => isGuest() || (S.get("autoNext") && !paused);
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
  opponent.newRound();
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
    if (voidStreak >= MAX_VOIDS && S.get("autoNext")) {
      paused = true;
      setResult("Paused — no hands seen. Press Next throw when you're ready.");
      voidStreak = 0;
    }
    updatePlayButton();
    if (S.get("autoNext") && !paused) autoTimer = setTimeout(hostTurn, 0);
  } catch (e) {
    busy = false;
    updatePlayButton();
    if (!(e instanceof Cancelled)) console.error(e);
  }
}

function showMatchOver() {
  const w = fight.matchWinner;
  const n = names()[w];
  const youWon = mode !== "local" && w === 0;
  el.matchEmoji.textContent = mode === "local" ? "🏆" : youWon ? "🏆" : mode === "cpu" ? opponent.npc.emoji : "😤";
  el.matchTitle.textContent = n === "YOU" ? "You win the match!" : `${n} wins the match!`;
  el.matchScore.textContent = `Rounds ${fight.roundWins[0]} – ${fight.roundWins[1]}`;
  el.matchOpp.hidden = mode !== "cpu" || !!schoolDuel;
  el.matchMenu.textContent = schoolDuel ? "Back to school" : "Main menu";
  if (schoolDuel) school.duelEnded(w === 0);
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
  if (overlayOpen() || !el.matchModal.hidden) return;
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
    case "hand": // where their hand is, so your tile can move out of its way (display only)
      remoteHand = Array.isArray(m.b) && m.b.length === 4 && m.b.every(Number.isFinite) ? { b: m.b, at: performance.now() } : null;
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
      playMusic("fight");
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
document.querySelectorAll(".mode").forEach((b) =>
  b.addEventListener("click", () => {
    schoolDuel = null;
    if (b.dataset.mode === "cpu") openPicker();
    else if (b.dataset.mode === "school") openSchool();
    else chooseMode(b.dataset.mode);
  }),
);
el.play.addEventListener("click", () => {
  unlockAudio();
  paused = false;
  hostTurn();
});
el.pause.addEventListener("click", togglePause);
el.rematch.addEventListener("click", startMatch);
el.matchMenu.addEventListener("click", () => (schoolDuel ? backToSchool() : backToMenu()));
el.matchOpp.addEventListener("click", () => {
  el.matchModal.hidden = true;
  openPicker();
});
el.menuBtn.addEventListener("click", () => (schoolDuel ? backToSchool() : backToMenu()));
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
el.arenaSelect.addEventListener("change", () => {
  S.set("arena", el.arenaSelect.value);
  const id = el.arenaSelect.value === "random" ? randomArena(arenaId) : el.arenaSelect.value;
  applyArena(id);
  if (mode === "online" && net?.isHost) net.send({ t: "arena", id });
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
  if (open && !cameraOn) effects.onStatus("Turn on the camera (Test hand, on the main menu) to see your look.");
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
  if (!paused && !busy && S.get("autoNext")) hostTurn();
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
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "escape" && closeTopPanel()) return;
  if (k === "m" && el.lobby.hidden) return toggleMute();
  if (overlayOpen()) return;
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

// ---------- screens: landing, menu, game ----------
let frameCount = 0;

/** A full screen or panel that takes over input (game keys and power signs are ignored). */
function overlayOpen() {
  return [el.landing, el.handTest, el.menu, el.school, el.lobby, el.camHelp, el.howto, el.settingsPanel, el.oppPicker].some((p) => !p.hidden);
}

/** Esc: close the topmost closable panel. Returns true if it closed one. */
function closeTopPanel() {
  if (!el.settingsPanel.hidden) return closeSettings(), true;
  if (!el.howto.hidden) return (el.howto.hidden = true), true;
  if (!el.oppPicker.hidden) return closePicker(), true;
  if (!el.lookSheet.hidden && overlayOpen()) return toggleLookSheet(false), true;
  return false;
}

/** Screens: landing (title page) → menu (pick a game) → game. The hand test is its own screen. */
function showScreen(name) {
  el.landing.hidden = name !== "landing";
  el.handTest.hidden = name !== "handtest";
  el.menu.hidden = name !== "menu";
  if (name !== "school" && !el.school.hidden) school.close();
  el.school.hidden = name !== "school";
  document.body.dataset.screen = name;
  placeStage(name === "handtest" ? "calib" : "game");
  if (name !== "game") playMusic("menu");
  if (name === "handtest") resetCalibration();
  if (name === "menu") renderCamBar();
  applyLayout();
}

/** Menu: a clear way to turn the camera on while it's off. */
function renderCamBar() {
  el.camBar.hidden = cameraOn;
  el.menuTag.textContent = cameraOn ? "Point at a mode and hold, or click." : "Pick a game.";
}

/** The one camera stage lives in the hand test card on the hand test screen, and in the arena otherwise. */
function placeStage(where) {
  const host = where === "calib" ? el.calibSlot : el.cornerL;
  if (el.stage.parentElement !== host) host.appendChild(el.stage);
  el.stage.hidden = where === "calib" && !cameraOn;
  el.calibIdle.hidden = cameraOn;
}

// ---------- tracking status chip ----------
let chipKey = "";
let fps = 0;
let fpsAt = 0;
function setTrackChip(state, text) {
  if (state + text === chipKey) return;
  chipKey = state + text;
  document.querySelectorAll("[data-track-chip]").forEach((c) => {
    c.className = `tracking-chip ${state}`;
    c.querySelector("span").textContent = text;
    c.title = text;
  });
}
function updateTrackChip(t = performance.now()) {
  if (!cameraOn) return setTrackChip("off", "Camera off");
  if (t - fpsAt > 1000) {
    fps = Math.round((frameCount * 1000) / (t - fpsAt || 1));
    frameCount = 0;
    fpsAt = t;
  }
  const any = live[0].visible || live[1].visible;
  setTrackChip(any ? "hand" : "nohand", any ? `Hand tracked · ${fps} fps` : "Show your hand");
}

// ---------- hand test screen ----------
const tried = new Set();
let tryHold = { g: null, since: 0 };

function resetCalibration() {
  tried.clear();
  tryHold = { g: null, since: 0 };
  renderCalib();
}

function updateCalibration(t) {
  const l = live[0].visible ? live[0] : live[1];
  const box = l.box;
  const size = box ? Math.max(box[2] - box[0], box[3] - box[1]) : 0;
  const dist = !box ? null : size < 0.16 ? "far" : size > 0.62 ? "near" : l.edge ? "edge" : "ok";
  const g = l.gesture || null;
  if (g !== tryHold.g) tryHold = { g, since: t };
  else if (g && t - tryHold.since > 300 && !tried.has(g)) {
    tried.add(g);
    sfx.arm();
  }
  renderCalib(l, dist, g);
}

function setNode(node, cls, text) {
  const key = cls + "|" + text;
  if (node.dataset.k === key) return;
  node.dataset.k = key;
  node.className = node.className.split(" ")[0] + (cls ? ` ${cls}` : "");
  const t = node.querySelector(".txt");
  (t || node).textContent = text;
}

function renderCalib(l = {}, dist = null, g = null) {
  setNode(el.chkHand, l.visible ? "ok" : "", l.visible ? "Hand found" : "Raise a hand");
  const distText = { far: "Come closer", near: "Move back", edge: "Move hand in", ok: "Good distance" };
  setNode(el.chkDist, dist === "ok" ? "ok" : dist ? "warn" : "", distText[dist] || "Good distance");
  setNode(el.chkLight, !cameraOn ? "" : lightOk ? "ok" : "warn", !cameraOn || lightOk ? "Good light" : "More light");
  el.handTest.querySelectorAll("[data-try]").forEach((n) => {
    n.classList.toggle("done", tried.has(n.dataset.try));
    n.classList.toggle("live", g === n.dataset.try);
  });
  const pill = !cameraOn
    ? ["", "Not started"]
    : tried.size === 3
      ? ["ok", "✓ Ready to play"]
      : l.visible
        ? ["warn", `Shapes ${tried.size}/3`]
        : ["", "Show your hand"];
  setNode(el.calibPill, pill[0], pill[1]);
}

/** Hand test screen: start the camera (the browser asks for permission) and show the live checks. */
async function startCameraForTest() {
  wantCam = true;
  unlockAudio();
  el.calibStart.disabled = el.camBtn.disabled = true;
  await ensureCamera();
  el.calibStart.disabled = el.camBtn.disabled = false;
  if (!el.handTest.hidden) placeStage("calib");
  renderCalib();
}

function openHandTest() {
  mode = "cpu";
  document.body.dataset.mode = "cpu";
  showScreen("handtest");
  if (!cameraOn) startCameraForTest();
  else tracker.setNumHands(1);
}

/** Leave the title page: an invite link goes straight to the online lobby, otherwise to the game menu. */
async function cameraAllowed() {
  try {
    return window.isSecureContext && (await navigator.permissions?.query({ name: "camera" }))?.state === "granted";
  } catch {
    return false;
  }
}

function leaveLanding() {
  unlockAudio();
  // Allowed on an earlier visit: start the camera now (no prompt appears). Nothing starts before Play.
  cameraAllowed().then((ok) => ok && !cameraOn && ensureCamera().then(() => !el.menu.hidden && renderCamBar()));
  const code = cleanCode(new URLSearchParams(location.search).get("room"));
  if (code.length === 4) chooseMode("online");
  else showScreen("menu");
}

el.startBtn.addEventListener("click", leaveLanding);
el.calibStart.addEventListener("click", startCameraForTest);
el.calibDone.addEventListener("click", () => showScreen("menu"));
el.camBtn.addEventListener("click", openHandTest);
el.retestBtn.addEventListener("click", openHandTest);
el.howtoBtn.addEventListener("click", () => (el.howto.hidden = false));
el.howto.addEventListener("click", (e) => {
  if (e.target === el.howto || e.target.closest("[data-close]")) el.howto.hidden = true;
});
document.querySelectorAll("[data-open-look]").forEach((b) => b.addEventListener("click", () => toggleLookSheet(true)));
document.querySelectorAll("[data-mute]").forEach((b) => b.addEventListener("click", toggleMute));

// ---------- VS CPU opponents: picker, name tag, speech bubble, Easy hint panel ----------
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

function buildPicker() {
  el.oppList.innerHTML = GROUPS.map((grp) => {
    const cards = ROSTER.filter((n) => n.group === grp.id)
      .map(
        (n) =>
          `<button type="button" class="opp" data-opp="${n.id}"><b class="em">${n.emoji}</b>` +
          `<span class="opp-txt"><b>${n.name}</b><small>${n.title}</small></span>` +
          `<span class="opp-meta"><span class="trait">${n.trait}</span><span class="stars" aria-label="Difficulty ${n.stars} of 5">${stars(n.stars)}</span></span></button>`,
      )
      .join("");
    return `<section class="opp-group"><h3>${grp.label}</h3><div class="opp-grid">${cards}</div></section>`;
  }).join("");
}

function syncPickerDifficulty() {
  const d = S.get("difficulty");
  el.oppDifficulty.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === d)));
}

function openPicker() {
  unlockAudio();
  const cur = S.get("opponent");
  el.oppList.querySelectorAll(".opp").forEach((b) => b.classList.toggle("on", b.dataset.opp === cur));
  syncPickerDifficulty();
  el.oppPicker.hidden = false;
  (el.oppList.querySelector(".opp.on") || el.oppList.querySelector(".opp"))?.focus();
}

function closePicker() {
  el.oppPicker.hidden = true;
  // Closed from the match-over screen without choosing: show it again.
  if (document.body.dataset.screen === "game" && mode === "cpu" && fight.matchWinner !== null) el.matchModal.hidden = false;
}

function pickOpponent(id) {
  S.set("opponent", id);
  opponent = createOpponent(id, { easy: S.get("difficulty") === "easy" });
  el.oppPicker.hidden = true;
  if (document.body.dataset.screen === "game" && mode === "cpu") {
    applyModeUI();
    startMatch();
  } else chooseMode("cpu");
}

el.oppPicker.addEventListener("click", (e) => {
  if (e.target === el.oppPicker || e.target.closest("[data-close]")) return closePicker();
  const card = e.target.closest("[data-opp]");
  if (card) return pickOpponent(card.dataset.opp);
  const d = e.target.closest("#oppDifficulty button");
  if (d) S.set("difficulty", d.dataset.v);
});

/** Battle view v1: the opponent's avatar flinches when hit and falls on a K.O.; Echo's twist shows your last throw. */
function reactAvatar(ev, mine) {
  const av = el.oppAvatar;
  if (ev.hurt === 1) {
    av.classList.remove("hit");
    void av.offsetWidth;
    av.classList.add("hit");
  }
  if (ev.ko && ev.victor === 0) av.classList.add("ko");
  if (twist()?.showLast && mine) {
    el.lastThrow.innerHTML = `Your last throw: <b>${GESTURES[mine].emoji}</b>`;
    el.lastThrow.hidden = false;
  }
}

function renderOpponent() {
  const n = opponent.npc;
  avatarCanvas((schoolDuel && schoolOpts?.avatar) || n.avatar, { scale: 8, canvas: el.oppAvatar });
  const t = twist();
  el.twistChip.textContent = t?.label || "";
  el.twistChip.hidden = !t;
  el.oppEmoji.textContent = n.emoji;
  el.oppName.textContent = n.name;
  el.oppTrait.textContent = n.trait;
  el.rpName.textContent = n.name;
  el.oppTag.hidden = mode !== "cpu";
  renderRead();
}

let sayTimer = null;
/** Speech bubble over the opponent: intro lines and tells. */
function oppSay(text, ms = 2500, cls = "") {
  clearTimeout(sayTimer);
  el.oppSay.textContent = text;
  el.oppSay.className = `opp-say ${cls}`;
  el.oppSay.hidden = false;
  sayTimer = setTimeout(() => (el.oppSay.hidden = true), ms);
}

/** Easy only: the opponent's recent throws, how often they use each, and their habit in words. */
function renderRead() {
  const show = mode === "cpu" && opponent.easy;
  el.readPanel.hidden = !show;
  if (!show) return;
  const h = opponent.hint();
  el.rpHist.innerHTML = h.recent.length
    ? h.recent.map((r) => `<span class="${r.result}" title="${GESTURES[r.g].label}: they ${r.result === "win" ? "won" : r.result === "lose" ? "lost" : "drew"}">${GESTURES[r.g].emoji}</span>`).join("")
    : `<em>Their throws will show here</em>`;
  el.rpBars.innerHTML = GESTURE_KEYS.map((g) => {
    const c = h.counts[g];
    const pct = h.total ? Math.round((c / h.total) * 100) : 0;
    return `<div class="rp-bar"><span>${GESTURES[g].emoji}</span><i><u style="width:${pct}%"></u></i><span>${c}</span></div>`;
  }).join("");
  el.rpHint.textContent = `💡 ${h.text}`;
}
buildPicker();

// ---------- school map (RPG preview) ----------
const school = new School(el.school, {
  onDuel: startSchoolDuel,
  onExit: () => showScreen("menu"),
  sfx,
  playMusic,
  inputBlocked: () => [el.camHelp, el.howto, el.settingsPanel].some((p) => !p.hidden) || !el.lookSheet.hidden,
});

function openSchool() {
  unlockAudio();
  showScreen("school");
  school.open().catch((e) => {
    console.error(e);
    showScreen("menu");
    setStatus("Couldn't load the school map. Check your connection and try again.", true);
  });
}

/** A classmate on the map challenged you: play the duel in the normal VS CPU screen. */
function startSchoolDuel(id, opts = {}) {
  schoolDuel = id;
  schoolOpts = opts;
  opponent = createOpponent(id, { easy: S.get("difficulty") === "easy" });
  chooseMode("cpu");
}

function backToSchool() {
  cancelFlow();
  el.matchModal.hidden = el.lookSheet.hidden = true;
  schoolDuel = null;
  schoolOpts = null;
  opponent = createOpponent(S.get("opponent"), { easy: S.get("difficulty") === "easy" }); // VS CPU keeps your own pick
  showScreen("school");
  school.resume();
}

// ---------- camera help ----------
function showCamHelp(e) {
  const code = e instanceof CameraError ? e.code : "model";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
  const mac = /Mac/.test(ua) && !ios;
  const win = /Windows/.test(ua);
  const browser = /Edg\//.test(ua) ? "edge" : /Firefox\//.test(ua) ? "firefox" : /Safari\//.test(ua) && !/Chrom/.test(ua) ? "safari" : "chrome";
  const sitePerm = {
    chrome: ["Click the camera or settings icon in the address bar", "Set <b>Camera</b> to <b>Allow</b>, then press Try again."],
    edge: ["Click the lock icon in the address bar", "Under Permissions set <b>Camera</b> to <b>Allow</b>, then press Try again."],
    firefox: ["Click the crossed-out camera icon in the address bar", "Clear the <b>Blocked</b> camera permission, then press Try again."],
    safari: ios
      ? ["Tap <b>aA</b> in the address bar", "Website Settings → Camera → <b>Allow</b>, then reload the page."]
      : ["Safari menu → Settings for this website…", "Set <b>Camera</b> to <b>Allow</b>, then press Try again."],
  }[browser];
  const os = mac
    ? ["On a Mac, check System Settings", "Privacy &amp; Security → Camera → turn your browser on, then restart the browser."]
    : win
      ? ["On Windows, check Settings", "Privacy &amp; security → Camera → allow apps (and desktop apps) to use the camera."]
      : null;
  const busy = ["Close other apps using the camera", "Zoom, Teams, FaceTime, Meet or OBS can hold onto it."];
  const content = {
    denied: ["🚫📷", "Your camera is blocked", "The browser said no to the camera for this site. Here's how to turn it back on:", [sitePerm, os, busy]],
    notfound: ["🔌", "No camera found", "The browser can't see a camera on this device.", [["Plug in a webcam, or open the laptop lid", "Then press Try again."], os, ["Try another browser", "Chrome, Edge, Firefox or Safari all work."]]],
    busy: ["⏳", "Your camera is busy", "Another app or tab is using it right now.", [busy, ["Close other tabs with this game open", "Only one tab can use the camera at a time."], ["Unplug and replug a USB webcam", "Then press Try again."]]],
    insecure: ["🔒", "Camera needs a secure page", "Browsers only allow the camera on https:// pages or localhost.", [["Open the https:// address", "For example the GitHub Pages link, or the https:// link that serve.py prints for phones."]]],
    unsupported: ["🧭", "This browser can't use the camera", "It doesn't support camera access for web pages.", [["Use a recent browser", "Chrome, Edge, Firefox, or Safari 15.4 and later."]]],
    model: ["📡", "Couldn't load the hand tracker", "The camera works, but the tracking model didn't download.", [["Check your internet connection", "The model is about 8 MB the first time, then cached."], ["Pause ad or script blockers for this site", "They can block cdn.jsdelivr.net or storage.googleapis.com."]]],
  };
  const [icon, title, text, steps] = content[code] || content.model;
  el.camHelpIcon.textContent = icon;
  el.camHelpTitle.textContent = title;
  el.camHelpText.textContent = code === "unknown" ? e.message : text;
  el.camHelpSteps.innerHTML = steps
    .filter(Boolean)
    .map(([b, d]) => `<li><div><b class="t">${b}</b>${d}</div></li>`)
    .join("");
  el.camHelp.hidden = false;
}
el.camRetry.addEventListener("click", async () => {
  el.camHelp.hidden = true;
  if (resumeMode) return chooseMode(resumeMode);
  if (!el.handTest.hidden) await startCameraForTest();
  else {
    wantCam = true;
    await ensureCamera();
    showScreen(document.body.dataset.screen);
  }
});
el.camSkip.addEventListener("click", () => {
  el.camHelp.hidden = true;
  wantCam = false;
  if (resumeMode) return chooseMode(resumeMode);
  showScreen(el.handTest.hidden && document.body.dataset.screen === "game" ? "game" : "menu");
});

// ---------- hand cursor ----------
function cursorScope() {
  for (const p of [el.camHelp, el.settingsPanel, el.howto, el.oppPicker, el.lobby, el.matchModal]) if (!p.hidden) return p;
  if (!el.lookSheet.hidden && !collecting) return el.lookSheet;
  if (!el.landing.hidden) return el.landing;
  if (!el.handTest.hidden) return el.handTest;
  if (!el.school.hidden) return el.school;
  if (!el.menu.hidden) return el.menu;
  if (!busy && !collecting) return el.dock; // idle between throws: Next throw, layout, settings
  return null;
}
const cursor = new HandCursor({
  scope: cursorScope,
  config: () => ({ enabled: S.get("cursor"), smoothing: S.get("smoothing"), speed: S.get("speed"), dwell: S.get("dwell") }),
  onHover: () => sfx.hover(),
  onPress: () => sfx.press(),
});

// ---------- settings ----------
function toggleMute() {
  unlockAudio();
  S.set("muted", !S.get("muted"));
}

async function restartCamera() {
  try {
    await tracker.startCamera(tracker.facingMode);
    el.stage.classList.toggle("mirrored", tracker.mirrored);
    net?.replaceVideoTrack(outgoingStream());
  } catch (e) {
    showCamHelp(e);
  }
}

function applySettings(k = null) {
  const s = S.all();
  setAudio({ volume: s.master / 100, muted: s.muted, sfx: s.sfx, music: s.music });
  document.querySelectorAll("[data-mute]").forEach((b) => {
    b.textContent = s.muted ? "🔇" : "🔊";
    b.setAttribute("aria-pressed", String(s.muted));
  });
  document.body.classList.toggle("lite", s.lite);
  tracker.mirrorPref = s.mirror;
  el.stage.classList.toggle("mirrored", tracker.mirrored);
  tracker.quality = s.quality;
  if (k === "quality" && tracker.stream) restartCamera();
  if (k === "autoNext") {
    paused = false;
    updatePlayButton();
    if (s.autoNext && !busy && !overlayOpen() && fight.matchWinner === null && !needIntro && !isGuest()) hostTurn();
  }
  if (k === null || k === "arena") el.arenaSelect.value = s.arena;
  if (k === null || k === "pipSize" || k === "pipAnchor") {
    pipAt = s.pipAnchor;
    placePip();
  }
  if (k === null || k === "difficulty") {
    opponent.setEasy(s.difficulty === "easy");
    renderRead();
    syncPickerDifficulty();
  }
  syncSettingsPanel();
}
S.onChange(applySettings);

let settingsTab = "audio";
function selectTab(tab) {
  settingsTab = tab;
  el.settingsPanel.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  el.settingsPanel.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab));
}

function openSettings() {
  // Don't let a throw run under the panel.
  if (document.body.dataset.screen === "game" && mode !== "online" && !paused && busy) togglePause();
  el.settingsPanel.hidden = false;
  selectTab(settingsTab);
  syncSettingsPanel();
}
function closeSettings() {
  el.settingsPanel.hidden = true;
}

const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFullscreen() {
  const d = document.documentElement;
  if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  else (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d)?.catch?.(() => {});
}

function syncSettingsPanel() {
  const s = S.all();
  const P = el.settingsPanel;
  P.querySelectorAll(".toggle[data-set]").forEach((b) => b.setAttribute("aria-checked", String(!!s[b.dataset.set])));
  P.querySelectorAll("input[type=range][data-set]").forEach((i) => (i.value = s[i.dataset.set]));
  P.querySelectorAll(".seg[data-set]").forEach((g) =>
    g.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(String(s[g.dataset.set]) === b.dataset.v))),
  );
  const out = { master: `${s.master}%`, smoothing: `${s.smoothing}%`, speed: `${s.speed}×` };
  P.querySelectorAll("[data-out]").forEach((o) => (o.textContent = out[o.dataset.out]));
  el.fsToggle.setAttribute("aria-checked", String(!!fsEl()));
}

function bindSettingsPanel() {
  const P = el.settingsPanel;
  P.addEventListener("click", (e) => {
    if (e.target === P) return closeSettings();
    const b = e.target.closest("button");
    if (!b) return;
    unlockAudio();
    if (b.matches("[data-close]")) return closeSettings();
    if (b.dataset.tab) return selectTab(b.dataset.tab);
    if (b === el.fsToggle) return toggleFullscreen();
    if (b === el.resetSettings) return S.reset();
    if (b.classList.contains("toggle") && b.dataset.set) return S.set(b.dataset.set, !S.get(b.dataset.set));
    if (b.dataset.step) {
      const [k, d] = b.dataset.step.split(":");
      return S.set(k, Math.round((S.get(k) + Number(d)) * 100) / 100);
    }
    const seg = b.closest(".seg[data-set]");
    if (seg && b.dataset.v) {
      const k = seg.dataset.set;
      S.set(k, typeof S.DEFAULTS[k] === "number" ? Number(b.dataset.v) : b.dataset.v);
    }
  });
  P.addEventListener("input", (e) => {
    const i = e.target;
    if (i.matches("input[type=range][data-set]")) S.set(i.dataset.set, Number(i.value));
  });
  el.fsRow.hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  document.addEventListener("fullscreenchange", syncSettingsPanel);
  document.addEventListener("webkitfullscreenchange", syncSettingsPanel);
  document.querySelectorAll("[data-open-settings]").forEach((b) => b.addEventListener("click", openSettings));
}

// ---------- in-game layout: side by side, or one big video and a movable tile ----------
const ANCHORS = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];
const PIP_W = [0.2, 0.28, 0.36];
let pipAt = S.get("pipAnchor"); // where the tile is now; differs from the saved spot while dodging a hand
let homeFreeSince = 0;
let dragging = false;

const isSpot = () => document.body.dataset.screen === "game" && mode !== "local" && layout !== "split";
const pipCorner = () => (layout === "me" ? el.cornerR : el.cornerL);

function setLayout(l) {
  layout = l;
  pipAt = S.get("pipAnchor");
  applyLayout();
}

function applyLayout() {
  const spot = isSpot();
  const meBig = layout === "me";
  document.body.classList.toggle("spot", spot);
  el.ring.classList.toggle("spot", spot);
  el.cornerL.classList.toggle("big", spot && meBig);
  el.cornerL.classList.toggle("pip", spot && !meBig);
  el.cornerR.classList.toggle("big", spot && !meBig);
  el.cornerR.classList.toggle("pip", spot && meBig);
  el.layoutSwitch
    .querySelectorAll("button")
    .forEach((b) => b.setAttribute("aria-checked", String(b.dataset.layout === layout)));
  if (spot) requestAnimationFrame(placePip);
}

/** Tile size and position for an anchor, relative to the arena box. */
function pipGeom(anchor) {
  const R = el.ring.getBoundingClientRect();
  const stage = pipCorner().querySelector(".stage");
  const ar = Number(stage.style.getPropertyValue("--arw") || 4) / Number(stage.style.getPropertyValue("--arh") || 3);
  let w = Math.min(460, Math.max(130, R.width * PIP_W[S.get("pipSize")]));
  let h = w / ar;
  if (h > R.height * 0.5) {
    h = R.height * 0.5;
    w = h * ar;
  }
  const m = 10;
  const xs = { l: m, c: (R.width - w) / 2, r: R.width - w - m };
  const ys = { t: m, m: (R.height - h) / 2, b: R.height - h - m };
  return { x: xs[anchor[1]], y: ys[anchor[0]], w, h, R };
}

function placePip() {
  if (!isSpot() || dragging || compact()) return; // phones: the tile is a fixed badge in the HUD (CSS)
  const g = pipGeom(pipAt);
  const c = pipCorner();
  c.style.setProperty("--pip-w", `${g.w}px`);
  c.style.setProperty("--pip-x", `${g.x}px`);
  c.style.setProperty("--pip-y", `${g.y}px`);
}

/** Where the hand in the big video is on screen, so the tile can keep out of its way. */
function bigHandRect() {
  if (layout === "them") {
    if (mode === "cpu") return el.cpuHand.getBoundingClientRect();
    if (mode === "online" && remoteHand && performance.now() - remoteHand.at < 1500 && el.remoteVideo.videoWidth)
      return videoBoxToRect(el.remoteVideo, remoteHand.b, false);
  } else if (layout === "me" && cameraOn && live[0].box) return videoBoxToRect(el.video, live[0].box, tracker.mirrored);
  return null;
}

/** A box in a video's own 0-1 frame to screen pixels, for a video shown with object-fit: cover. */
function videoBoxToRect(v, [x0, y0, x1, y1], mirrored) {
  const r = v.getBoundingClientRect();
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const s = Math.max(r.width / vw, r.height / vh);
  const ox = r.left + (r.width - vw * s) / 2;
  const oy = r.top + (r.height - vh * s) / 2;
  if (mirrored) [x0, x1] = [1 - x1, 1 - x0];
  return { left: ox + x0 * vw * s, right: ox + x1 * vw * s, top: oy + y0 * vh * s, bottom: oy + y1 * vh * s };
}

function dodgeHand() {
  if (!isSpot() || dragging || compact()) return;
  const home = S.get("pipAnchor");
  const hand = bigHandRect();
  const pad = 16;
  const blocks = (a) => {
    if (!hand) return false;
    const g = pipGeom(a);
    const x = g.R.left + g.x;
    const y = g.R.top + g.y;
    return !(x + g.w < hand.left - pad || x > hand.right + pad || y + g.h < hand.top - pad || y > hand.bottom + pad);
  };
  const t = performance.now();
  let next = pipAt;
  if (blocks(pipAt)) {
    // Nearest free spot to home, so the tile moves as little as it can.
    const pos = (a) => pipGeom(a);
    const h = pos(home);
    const free = ANCHORS.filter((a) => !blocks(a)).sort(
      (a, b) => Math.hypot(pos(a).x - h.x, pos(a).y - h.y) - Math.hypot(pos(b).x - h.x, pos(b).y - h.y),
    );
    if (free.length) next = free[0];
    homeFreeSince = 0;
  } else if (pipAt !== home) {
    // Go back home once it has been clear for a moment (no ping-ponging while a hand moves around).
    if (blocks(home)) homeFreeSince = 0;
    else if (!homeFreeSince) homeFreeSince = t;
    else if (t - homeFreeSince > 1200) next = home;
  }
  if (next !== pipAt) {
    pipAt = next;
    placePip();
  }
}
setInterval(dodgeHand, 250);

function bindPipDrag(corner) {
  corner.addEventListener("pointerdown", (e) => {
    if (!corner.classList.contains("pip") || e.target.closest("button") || e.button > 0) return;
    if (compact()) return; // phones: tap the badge to peek instead (see the click handler)
    e.preventDefault();
    const g = pipGeom(pipAt);
    const off = [e.clientX - (g.R.left + g.x), e.clientY - (g.R.top + g.y)];
    dragging = true;
    corner.classList.add("dragging");
    try {
      corner.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer: moves still arrive while over the tile */
    }
    const at = (ev) => [ev.clientX - g.R.left - off[0], ev.clientY - g.R.top - off[1]];
    const move = (ev) => {
      const [x, y] = at(ev);
      corner.style.setProperty("--pip-x", `${x}px`);
      corner.style.setProperty("--pip-y", `${y}px`);
    };
    const up = (ev) => {
      corner.removeEventListener("pointermove", move);
      corner.removeEventListener("pointerup", up);
      corner.removeEventListener("pointercancel", up);
      dragging = false;
      corner.classList.remove("dragging");
      // Snap to the nearest edge spot.
      const [x, y] = at(ev);
      const cx = x + g.w / 2;
      const cy = y + g.h / 2;
      let best = pipAt;
      let bestD = Infinity;
      for (const a of ANCHORS) {
        const p = pipGeom(a);
        const d = Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy);
        if (d < bestD) [best, bestD] = [a, d];
      }
      pipAt = best;
      homeFreeSince = 0;
      if (best === S.get("pipAnchor")) placePip();
      else S.set("pipAnchor", best);
    };
    corner.addEventListener("pointermove", move);
    corner.addEventListener("pointerup", up);
    corner.addEventListener("pointercancel", up);
  });
  corner.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pip]");
    if (!b && compact() && corner.classList.contains("pip") && !e.target.closest(".powers")) {
      corner.classList.toggle("peek"); // phones: tap the badge to see it bigger, tap again to shrink
      return;
    }
    if (!b) return;
    if (b.dataset.pip === "size") S.set("pipSize", (S.get("pipSize") + 1) % 3);
    else setLayout(layout === "me" ? "them" : "me");
  });
}
bindPipDrag(el.cornerL);
bindPipDrag(el.cornerR);
el.layoutSwitch.addEventListener("click", (e) => {
  const b = e.target.closest("[data-layout]");
  if (b) setLayout(b.dataset.layout);
});
window.addEventListener("resize", () => isSpot() && placePip());

// ---------- phones: focus layout (camera badge in the HUD, dock as a pull-up sheet) ----------
function onCompactChange() {
  document.body.classList.toggle("compact", compact());
  el.cornerL.classList.remove("peek");
  el.cornerR.classList.remove("peek");
  setDockOpen(false);
  renderPowers();
  applyLayout();
}
compactMQ.addEventListener("change", onCompactChange);

function setDockOpen(open) {
  el.dock.classList.toggle("open", open);
  el.dockGrab.setAttribute("aria-expanded", String(open));
  el.dockGrab.querySelector("span").textContent = open ? "Close" : "Swipe up for menu";
}
{
  let y0 = null;
  let moved = false;
  el.dockGrab.addEventListener("pointerdown", (e) => {
    y0 = e.clientY;
    moved = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (y0 === null || moved) return;
    const dy = e.clientY - y0;
    if (Math.abs(dy) > 24) {
      moved = true;
      setDockOpen(dy < 0);
    }
  });
  window.addEventListener("pointerup", () => (y0 = null));
  el.dockGrab.addEventListener("click", () => {
    if (!moved) setDockOpen(!el.dock.classList.contains("open"));
    moved = false;
  });
  // Tap outside the open sheet, or pick something in it, to close it.
  document.addEventListener("click", (e) => {
    if (!el.dock.classList.contains("open")) return;
    if (!el.dock.contains(e.target)) setDockOpen(false);
    else if (e.target.closest(".dock-tools button, #play")) setTimeout(() => setDockOpen(false), 120);
  });
}

/** Each stage takes its video's shape in spotlight, so nothing is cropped off the big video. */
function trackAspect(video, stage) {
  const set = () => {
    if (!video.videoWidth) return;
    stage.style.setProperty("--arw", String(video.videoWidth));
    stage.style.setProperty("--arh", String(video.videoHeight));
    if (isSpot()) placePip();
  };
  video.addEventListener("loadedmetadata", set);
  video.addEventListener("resize", set);
}
trackAspect(el.video, el.stage);
trackAspect(el.remoteVideo, el.stageR);

/** Online: tell the opponent roughly where my hand is (display only: their tile keeps clear of it). */
let handSentAt = 0;
let handSent = null;
function sendHand(t) {
  if (!net || t - handSentAt < 150) return;
  const b = live[0].box;
  const same = (!b && !handSent) || (b && handSent && b.every((v, i) => Math.abs(v - handSent[i]) < 0.03));
  if (same && t - handSentAt < 1000) return;
  handSentAt = t;
  handSent = b;
  net.send({ t: "hand", b: b ? b.map((v) => Math.round(v * 1000) / 1000) : null });
}

// ---------- boot ----------
for (const a of ARENAS) el.arenaSelect.add(new Option(a.name, a.id));
el.arenaSelect.value = S.get("arena");
if (el.arenaSelect.value !== S.get("arena")) el.arenaSelect.value = "random";
applyArena(randomArena());
renderHud();
updatePlayButton();
applySettings();
bindSettingsPanel();
showScreen("landing");

const invite = cleanCode(new URLSearchParams(location.search).get("room"));
if (invite.length === 4) {
  el.inviteNote.hidden = false;
  el.inviteNote.textContent = `🎟️ You're invited to online room ${invite}. Press Play to join.`;
}
