// Tiny Web Audio synth — no sound files to load. Sound effects and a chiptune music loop,
// each on its own bus under one master volume.
let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let noiseBuf = null;
const opts = { volume: 0.8, muted: false, sfx: true, music: true };
const MUSIC_LEVEL = 0.32; // music sits under the effects
let ducked = false;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    master.connect(ctx.destination);
    applyLevels(true);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function applyLevels(now = false) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const ramp = (param, v) => (now ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, 0.05));
  ramp(master.gain, opts.muted ? 0 : opts.volume);
  ramp(sfxBus.gain, opts.sfx ? 1 : 0);
  ramp(musicBus.gain, opts.music ? MUSIC_LEVEL * (ducked ? 0.35 : 1) : 0);
}

/** Call from a user gesture (click/key) so iOS Safari unlocks audio. */
export function unlockAudio() {
  try {
    ac();
    if (wantTrack && !timer) startMusic();
  } catch {
    /* audio unsupported */
  }
}

/** { volume 0-1, muted, sfx, music } — any subset. */
export function setAudio(o) {
  Object.assign(opts, o);
  applyLevels();
  if (wantTrack && musicWanted() && ctx && !timer) startMusic();
  if (!musicWanted()) stopMusic();
}

export function setMuted(m) {
  setAudio({ muted: m });
}
export function isMuted() {
  return opts.muted;
}

function tone(freq, start, dur, type = "square", gain = 0.12, bus = sfxBus, at = ctx.currentTime) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at + start);
  g.gain.setValueAtTime(0, at + start);
  g.gain.linearRampToValueAtTime(gain, at + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + start + dur);
  o.connect(g).connect(bus);
  o.start(at + start);
  o.stop(at + start + dur + 0.02);
}

function whiteNoise() {
  if (!noiseBuf) {
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Filtered noise burst — punches, impacts, hi-hats. */
function noise(start, dur, freq = 900, gain = 0.4, bus = sfxBus, at = ctx.currentTime, type = "lowpass") {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, at + start);
  g.gain.exponentialRampToValueAtTime(0.0001, at + start + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(at + start);
  src.stop(at + start + dur + 0.02);
}

/** Pitch sweep — whooshes and booms. */
function sweep(from, to, start, dur, type = "sawtooth", gain = 0.12, bus = sfxBus, at = ctx.currentTime) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, at + start);
  o.frequency.exponentialRampToValueAtTime(to, at + start + dur);
  g.gain.setValueAtTime(gain, at + start);
  g.gain.exponentialRampToValueAtTime(0.0001, at + start + dur);
  o.connect(g).connect(bus);
  o.start(at + start);
  o.stop(at + start + dur + 0.02);
}

function play(fn) {
  if (opts.muted || !opts.sfx) return;
  try {
    ac();
    fn();
  } catch {
    /* ignore audio errors */
  }
}

export const sfx = {
  tick: (step) => play(() => tone(440 + step * 110, 0, 0.12)),
  shoot: () => play(() => tone(988, 0, 0.18, "sawtooth", 0.1)),
  win: () => play(() => [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.18, "triangle", 0.18))),
  lose: () => play(() => [392, 330, 262].forEach((f, i) => tone(f, i * 0.11, 0.2, "sawtooth", 0.08))),
  draw: () => play(() => [440, 440].forEach((f, i) => tone(f, i * 0.12, 0.1, "triangle", 0.14))),
  miss: () => play(() => tone(180, 0, 0.25, "square", 0.08)),
  matchWin: () =>
    play(() => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.22, "triangle", 0.18))),
  round: () => play(() => [196, 294].forEach((f, i) => tone(f, i * 0.05, 0.9, "triangle", 0.16))),
  fight: () => play(() => { sweep(200, 900, 0, 0.35, "sawtooth", 0.1); noise(0, 0.35, 3000, 0.15); }),
  hit: (combo = 1) =>
    play(() => {
      noise(0, 0.18, 700 + combo * 300, 0.5);
      sweep(160, 50, 0, 0.2, "sine", 0.35);
    }),
  clash: () => play(() => { tone(1400, 0, 0.25, "square", 0.06); tone(1870, 0.02, 0.25, "square", 0.05); }),
  ko: () =>
    play(() => {
      noise(0, 0.6, 400, 0.6);
      sweep(220, 30, 0, 1.1, "sine", 0.45);
    }),
  /** A power-up was armed: rising shimmer. */
  arm: () => play(() => { sweep(500, 1600, 0, 0.25, "triangle", 0.1); tone(1600, 0.2, 0.15, "sine", 0.08); }),
  /** A power-up fired on the throw. */
  power: () => play(() => { sweep(120, 900, 0, 0.3, "sawtooth", 0.12); noise(0.05, 0.3, 2500, 0.2); }),
  matchLose: () => play(() => [392, 370, 349, 262].forEach((f, i) => tone(f, i * 0.16, 0.3, "sawtooth", 0.08))),
  /** Hand cursor: soft blip when it lands on a button, click when a hold presses it. */
  hover: () => play(() => tone(1320, 0, 0.05, "sine", 0.04)),
  press: () => play(() => { tone(660, 0, 0.07, "square", 0.06); tone(990, 0.05, 0.09, "square", 0.06); }),
};

// ---------- music ----------
// Each track: 4 bars of 16 sixteenth-note steps, one chord per bar, played by a small
// chip "band" (triangle bass, square arpeggio, noise hats, sine kick). Chords are MIDI note roots + quality.
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const MINOR = [0, 3, 7, 12];
const MAJOR = [0, 4, 7, 12];
const TRACKS = {
  menu: {
    bpm: 92,
    chords: [[57, MINOR], [53, MAJOR], [48, MAJOR], [55, MAJOR]], // Am F C G
    arp: [0, null, 1, null, 2, null, 3, null, 2, null, 1, null, 2, null, 1, null],
    bass: [0, null, null, null, null, null, 12, null, 0, null, null, null, null, null, 7, null],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    leadGain: 0.035,
  },
  fight: {
    bpm: 138,
    chords: [[52, MINOR], [52, MINOR], [48, MAJOR], [50, MAJOR]], // Em Em C D
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 3, 2],
    bass: [0, null, 0, 12, 0, null, 0, 12, 0, null, 0, 12, 0, null, 7, 12],
    hat: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    leadGain: 0.04,
  },
};

let wantTrack = null;
let track = null;
let timer = null;
let step = 0;
let nextTime = 0;

const musicWanted = () => opts.music && !opts.muted && opts.volume > 0;

/** Switch the music to 'menu' or 'fight' (or null for silence). Starts once audio is unlocked. */
export function playMusic(name) {
  wantTrack = name && TRACKS[name] ? name : null;
  if (!wantTrack) return stopMusic();
  if (track === TRACKS[wantTrack] && timer) return;
  track = TRACKS[wantTrack];
  step = 0;
  if (ctx && ctx.state === "running" && musicWanted()) startMusic();
}

/** Quieter during the countdown, so "Rock, Paper, Scissors, Shoot!" cuts through. */
export function duckMusic(on) {
  ducked = on;
  applyLevels();
}

function startMusic() {
  if (!musicWanted() || !wantTrack) return;
  track = TRACKS[wantTrack];
  stopMusic();
  nextTime = ctx.currentTime + 0.05;
  timer = setInterval(scheduleAhead, 50);
}

function stopMusic() {
  clearInterval(timer);
  timer = null;
}

function scheduleAhead() {
  if (!ctx || document.hidden) return;
  const stepDur = 60 / track.bpm / 4;
  if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.02; // tab was throttled: resync
  while (nextTime < ctx.currentTime + 0.12) {
    playStep(step, nextTime, stepDur);
    nextTime += stepDur;
    step = (step + 1) % 64;
  }
}

function playStep(s, at, stepDur) {
  try {
    const i = s % 16;
    const [root, quality] = track.chords[Math.floor(s / 16)];
    const a = track.arp[i];
    if (a !== null) tone(midi(root + 12 + quality[a]), 0, stepDur * 0.9, "square", track.leadGain, musicBus, at);
    const b = track.bass[i];
    if (b !== null) tone(midi(root - 12 + b), 0, stepDur * 1.8, "triangle", 0.13, musicBus, at);
    if (track.hat[i]) noise(0, 0.04, 7000, 0.05, musicBus, at, "highpass");
    if (track.kick[i]) sweep(140, 45, 0, 0.16, "sine", 0.3, musicBus, at);
  } catch {
    /* ignore */
  }
}
