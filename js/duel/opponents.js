// Computer opponents for a duel. The match flow in main.js only talks to this interface, so the same
// opponents can later be met on the school map or shown as avatars:
//   reset()                  new match
//   newRound()               a round starts (some NPCs open every round the same way)
//   plan(fight)              before the countdown: decide this throw → { gesture, tell }
//   power(fight)             the power-up to arm with the planned throw, or null
//   record(npc, player, ev)  after a legal exchange
//   hint()                   Easy-mode read: recent throws, counts and the NPC's habit
import { GESTURE_KEYS } from "../gesture.js";
import { POWER_KEYS, MAX_HP } from "../fight.js";
import { planThrow, planPower } from "../npc/strategy.js";
import { byId } from "../npc/roster.js";

const MEMORY_KEY = "handduel-npc-memory";
const MEMORY_MAX = 300;

function loadMemory() {
  try {
    const m = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
    return Array.isArray(m) ? m.filter((g) => GESTURE_KEYS.includes(g)).slice(-MEMORY_MAX) : [];
  } catch {
    return [];
  }
}
function saveMemory(m) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(m.slice(-MEMORY_MAX)));
  } catch {
    /* not saved: memory lasts for this visit */
  }
}

function secureRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

/** Side 0 is the player, side 1 the NPC (as in Fight). */
export function createOpponent(id, { easy = false, rng = secureRandom } = {}) {
  const npc = byId(id);
  const spec = npc.strategy;
  let history = [];
  let roundStart = true;
  let planned = null;
  const memory = spec.useMemory ? loadMemory() : [];

  const ctx = (fight) => ({
    history, memory, roundStart, maxHp: MAX_HP,
    npcHp: fight?.hp[1] ?? MAX_HP, playerHp: fight?.hp[0] ?? MAX_HP,
  });

  return {
    npc,
    get easy() {
      return easy;
    },
    setEasy(v) {
      easy = !!v;
    },
    reset() {
      history = [];
      roundStart = true;
      planned = null;
    },
    newRound() {
      roundStart = true;
    },
    plan(fight) {
      planned = planThrow(spec, ctx(fight), { rng, noiseScale: easy ? 0.5 : 1 });
      return planned;
    },
    power(fight) {
      const held = POWER_KEYS.filter((k) => fight.canUse(1, k));
      return planPower(spec, { held, npcHp: fight.hp[1], playerHp: fight.hp[0] }, { rng });
    },
    record(npcThrow, playerThrow, ev) {
      if (!npcThrow || !playerThrow) return; // only legal exchanges teach anything
      const result = ev?.result === "draw" ? "draw" : ev?.winner === 1 ? "win" : ev?.winner === 0 ? "lose" : "draw";
      history.push({ npc: npcThrow, player: playerThrow, result });
      roundStart = false;
      planned = null;
      if (spec.useMemory) {
        memory.push(playerThrow);
        saveMemory(memory);
      }
    },
    /** Everything the Easy hint panel shows. */
    hint() {
      const recent = history.slice(-6).map((h) => ({ g: h.npc, result: h.result }));
      const counts = Object.fromEntries(GESTURE_KEYS.map((g) => [g, history.filter((h) => h.npc === g).length]));
      return { recent, counts, total: history.length, text: npc.hint };
    },
  };
}
