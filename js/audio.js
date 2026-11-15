// Tiny Web Audio synth — no sound files to load.
let ctx = null;
let muted = false;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** Call from a user gesture (click/key) so iOS Safari unlocks audio. */
export function unlockAudio() {
  try {
    ac();
  } catch {
    /* audio unsupported */
  }
}

export function setMuted(m) {
  muted = m;
}
export function isMuted() {
  return muted;
}

function tone(freq, start, dur, type = "square", gain = 0.12) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
}

/** Filtered noise burst — punches, impacts. */
function noise(start, dur, freq = 900, gain = 0.4) {
  const c = ac();
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

/** Pitch sweep — whooshes and booms. */
function sweep(from, to, start, dur, type = "sawtooth", gain = 0.12) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, c.currentTime + start);
  o.frequency.exponentialRampToValueAtTime(to, c.currentTime + start + dur);
  g.gain.setValueAtTime(gain, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
}

function play(fn) {
  if (muted) return;
  try {
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
};
