import { GESTURES, GESTURE_KEYS, GestureBuffer, classify } from "./gesture.js";
import { Tracker, CameraError } from "./tracker.js";
import { sfx, unlockAudio, setMuted, isMuted } from "./audio.js";
import { Fight, MAX_HP, ROUNDS_TO_WIN } from "./fight.js";
import { ARENAS, showArena, randomArena, arenaById } from "./arenas.js";
import { Net, makeRoomCode, cleanCode, sha256, nonce } from "./net.js";

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(
  [
    "video", "overlay", "stage", "noCam", "halfL", "halfR", "badgeL", "badgeR", "tip", "stageR", "remoteVideo",
    "cpuHand", "ring", "announcer", "result", "play", "pause", "autoNext", "arenaSelect", "switchCam", "mute",
    "menuBtn", "menu", "useCam", "status", "lobby", "lobbyChoose", "lobbyHost", "roomCode", "copyLink",
    "lobbyStatus", "lobbyBack", "createRoom", "joinForm", "joinCode", "matchModal", "matchEmoji", "matchTitle",
    "matchScore", "rematch", "matchMenu", "fx", "arenaBg", "nameL", "nameR", "pipsL", "pipsR", "hpL", "hpR",
    "ghostL", "ghostR", "roundLabel", "arenaName", "manualL", "manualR",
  ].map((id) => [id, $(id)]),
);
const ctx2d = el.overlay.getContext("2d");

// ---------- timing (ms) ----------
const BEAT = 480; // per countdown word
const CAPTURE_BEFORE = 150; // accept gestures slightly before "Shoot!" (people throw early)...
const CAPTURE_AFTER = 450; // ...and shortly after
const REVEAL_HOLD = 1300;
const MAX_VOIDS = 3; // auto-play pauses after this many throws in a row with no hands

const MODES = {
  cpu: { names: ["YOU", "CPU"], hands: 1 },
  local: { names: ["P1", "P2"], hands: 2 },
  online: { names: ["YOU", "RIVAL"], hands: 1 },
};
const SIDE_COLORS = ["#38d6ff", "#ff8a3d"];

// ---------- state ----------
const tracker = new Tracker(el.video);
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
  el.matchModal.hidden = el.lobby.hidden = true;
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
    const c = h ? classify(h.world || h.landmarks) : { gesture: null, confidence: 0 };
    live[i] = { ...c, visible: !!h, edge: h ? nearEdge(h.landmarks) : false };
    buffers[i].push(c.gesture, t);
    if (h) drawHand(h.landmarks, mode === "local" ? SIDE_COLORS[i] : c.gesture ? "#3ee08f" : "#ffcc33");
  });
  updateBadges();
  if (t - lastLightCheck > 1200) {
    lastLightCheck = t;
    checkLight();
  }
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
    if (l.gesture) {
      text = `${GESTURES[l.gesture].emoji} ${GESTURES[l.gesture].label}`;
      cls = "found";
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
  document.querySelectorAll(".throw-badge, .dmg").forEach((n) => n.remove());
  el.cpuHand.textContent = "✊";
  el.cpuHand.classList.remove("reveal", "pump");
  document.querySelectorAll(".manual").forEach((g) => g.classList.remove("locked"));
  document.querySelectorAll(".manual button").forEach((b) => b.classList.remove("locked"));
}

function startMatch() {
  cancelFlow();
  fight.newMatch();
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
  const waitForCam = cameraOn && sidesInPlay.some((i) => !manual[i]);
  await sleep(waitForCam ? CAPTURE_AFTER : 150);
  collecting = false;
  el.cpuHand.classList.remove("pump");
  const pick = (i) =>
    manual[i] || (cameraOn ? buffers[i].vote(shootAt - CAPTURE_BEFORE, shootAt + CAPTURE_AFTER, 0.4) : null);
  return [pick(0), mode === "local" ? pick(1) : null];
}

/** One full throw. Returns 'next' | 'round' | 'match'. */
async function turn(intro, ex) {
  const gen = flowGen;
  if (intro) await roundIntro(intro);
  resetThrowVisuals();
  setResult("");
  let [a, b] = await countdown();
  let note = "";

  if (mode === "cpu") {
    if (!a) {
      clearAnnounce();
      setResult("Didn't catch your hand — hold it up on “Shoot!”");
      sfx.miss();
      voidStreak++;
      await sleep(900);
      return "next";
    }
    b = cpuPick();
  } else if (mode === "online") {
    announce("…", "small");
    const res = await exchangeOnline(ex, a);
    checkAlive(gen);
    if (res.timeout) {
      clearAnnounce();
      setResult("Connection hiccup — replaying the throw");
      await sleep(900);
      return "next";
    }
    b = res.gesture;
    if (res.cheat) note = " (opponent's throw didn't verify)";
  }

  let ev;
  try {
    ev = fight.exchange(a, b);
  } catch {
    ev = { result: "void" };
  }
  if (mode === "online" && !net.isHost) {
    // The host's state is the source of truth; fixes any drift after a network hiccup.
    const s = await receive(`state:${ex}`, 4000);
    checkAlive(gen);
    if (s) fight.restore(s.fight, true);
  } else if (mode === "online") {
    net.send({ t: "state", ex, fight: fight.snapshot() });
  }

  await present(a, b, ev, note);
  if (ev.ko) return koSequence(ev);
  await sleep(REVEAL_HOLD);
  return "next";
}

function throwBadge(i, g) {
  if (mode === "cpu" && i === 1) {
    el.cpuHand.textContent = GESTURES[g].emoji;
    el.cpuHand.classList.add("reveal");
    return;
  }
  const b = document.createElement("div");
  b.className = "throw-badge";
  b.textContent = g ? GESTURES[g].emoji : "💤";
  sideEl(i).appendChild(b);
}

async function present(a, b, ev, note) {
  clearAnnounce();
  throwBadge(0, a);
  throwBadge(1, b);
  const n = names();
  const label = (g) => (g ? GESTURES[g].label : "nothing");
  const youPov = mode !== "local"; // colour results from the local player's point of view

  if (ev.result === "void") {
    voidStreak++;
    setResult("No throws seen — again!");
    sfx.miss();
    return;
  }
  voidStreak = 0;
  if (ev.result === "draw") {
    announce("Clash!", "small");
    sfx.clash();
    setResult(`Both ${label(a)} — clash!${note}`, "draw");
    return;
  }

  const w = ev.winner;
  const wg = w === 0 ? a : b;
  const lg = w === 0 ? b : a;
  const text = ev.forfeit
    ? `${n[ev.loser]} ${n[ev.loser] === "YOU" ? "were" : "was"} too slow!`
    : `${label(wg)} beats ${label(lg)}`;
  const takes = n[ev.loser] === "YOU" ? "you take" : `${n[ev.loser]} takes`;
  setResult(`${text} — ${takes} ${ev.damage}${note}`, youPov ? (w === 0 ? "win" : "lose") : "win");

  // damage number + flash on the side that got hit
  const target = sideEl(ev.loser);
  const dmg = document.createElement("div");
  dmg.className = "dmg";
  dmg.innerHTML = `−${ev.damage}${ev.combo > 1 ? `<small>${ev.combo} HIT COMBO</small>` : ""}`;
  target.appendChild(dmg);
  setTimeout(() => dmg.remove(), 1100);
  target.classList.remove("hit-flash");
  void target.offsetWidth;
  target.classList.add("hit-flash");
  el.ring.classList.remove("shake");
  void el.ring.offsetWidth;
  el.ring.classList.add("shake");
  sfx.hit(ev.combo);
  if (ev.combo > 1) announce(`${ev.combo} hit combo!`, "small gold");
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
  const n = names()[ev.winner];
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
    if (el.autoNext.checked && !paused) autoTimer = setTimeout(hostTurn, 250);
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
async function exchangeOnline(ex, mine) {
  const g = mine || "none";
  const n = nonce();
  net.send({ t: "commit", ex, hash: await sha256(`${ex}:${g}:${n}`) });
  const theirs = await receive(`commit:${ex}`, 8000);
  if (!theirs) return { timeout: true };
  net.send({ t: "reveal", ex, g, n });
  const r = await receive(`reveal:${ex}`, 8000);
  if (!r) return { timeout: true };
  const valid = (await sha256(`${ex}:${r.g}:${r.n}`)) === theirs.hash && (r.g === "none" || r.g in GESTURES);
  return { gesture: valid && r.g !== "none" ? r.g : null, cheat: !valid };
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
      net.localStream = tracker.stream;
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
  const url = `${location.origin}${location.pathname}?room=${el.roomCode.textContent}`;
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
    net?.replaceVideoTrack(tracker.stream);
  } catch (e) {
    setResult(e.message, "lose");
  }
});

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
  } else if (k === "escape") togglePause();
  else if (k === "m") el.mute.click();
  else if (keyThrow(k)) throwManually(...keyThrow(k));
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
