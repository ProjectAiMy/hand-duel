// Fighting-game rules on top of Rock-Paper-Scissors. Pure logic, no DOM, so it's
// deterministic: online, both devices run the same exchanges and stay in sync.
import { outcome } from "./gesture.js";

export const MAX_HP = 100;
export const ROUNDS_TO_WIN = 2; // best of 3 rounds
// Damage by win streak: 1st hit, 2nd in a row, 3rd+ in a row. Three straight wins = K.O.
export const DAMAGE = [25, 35, 45];

/**
 * Power-ups: armed between throws (by hand sign or button), each usable once per round.
 * An armed power is spent on the next throw that isn't void, whatever the result.
 */
export const POWERS = {
  power: { emoji: "👉", sign: "Finger gun", label: "Power", desc: "Win this throw for 2× damage" },
  reverse: { emoji: "🤘", sign: "Horns", label: "Reverse", desc: "Lose this throw and the damage hits them instead" },
  shield: { emoji: "☝️", sign: "1 finger", label: "Shield", desc: "Lose this throw and take no damage" },
};
export const POWER_KEYS = Object.keys(POWERS);
const freshPowers = () => Object.fromEntries(POWER_KEYS.map((k) => [k, true]));

export class Fight {
  constructor() {
    this.newMatch();
  }

  newMatch() {
    this.round = 1;
    this.roundWins = [0, 0];
    this.matchWinner = null;
    this.newRound();
  }

  newRound() {
    this.hp = [MAX_HP, MAX_HP];
    this.streak = [0, 0];
    this.powers = [freshPowers(), freshPowers()]; // true = still available this round
    this.roundWinner = null;
  }

  /** Can `side` still use power `p` this round? */
  canUse(side, p) {
    return !!p && this.powers[side][p] === true;
  }

  nextRound() {
    this.round++;
    this.newRound();
  }

  /** Plain copy of the state, for the online host to send as the source of truth. */
  snapshot() {
    const { round, roundWins, hp, streak, roundWinner, matchWinner } = this;
    const powers = this.powers.map((p) => ({ ...p }));
    return { round, roundWins: [...roundWins], hp: [...hp], streak: [...streak], powers, roundWinner, matchWinner };
  }

  /** Load a snapshot; mirror=true swaps sides (the guest sees itself on the left). */
  restore(s, mirror = false) {
    const pair = (a) => (mirror ? [a[1], a[0]] : [...a]);
    const side = (x) => (x === null || x === undefined ? null : mirror ? 1 - x : x);
    this.round = s.round;
    this.roundWins = pair(s.roundWins);
    this.hp = pair(s.hp);
    this.streak = pair(s.streak);
    if (s.powers) this.powers = pair(s.powers).map((p) => ({ ...freshPowers(), ...p }));
    this.roundWinner = side(s.roundWinner);
    this.matchWinner = side(s.matchWinner);
  }

  /**
   * Resolve one throw. Side 0 = left player, side 1 = right player.
   * A missing throw (null) loses to any real throw ("too slow"); two misses are void.
   * `powers` = [left's armed power, right's armed power] (null or a POWERS key). Powers a side
   * has already used this round are ignored. Event fields: winner/loser are who won the throw;
   * `hurt` is who took the damage (the winner, if it was reversed); `used` = powers spent.
   */
  exchange(a, b, powers = [null, null]) {
    if (this.matchWinner !== null || this.roundWinner !== null) throw new Error("round is over");
    if (!a && !b) return { result: "void", winner: -1, damage: 0, used: [null, null] };

    const used = [0, 1].map((i) => (this.canUse(i, powers[i]) ? powers[i] : null));
    used.forEach((p, i) => p && (this.powers[i][p] = false));

    let winner;
    if (a && !b) winner = 0;
    else if (!a && b) winner = 1;
    else {
      const o = outcome(a, b);
      winner = o === "win" ? 0 : o === "lose" ? 1 : -1;
    }
    if (winner === -1) {
      this.streak = [0, 0];
      return { result: "draw", winner: -1, damage: 0, used };
    }

    const loser = 1 - winner;
    const forfeit = !a || !b;
    const combo = this.streak[winner] + 1;
    let damage = DAMAGE[Math.min(combo, DAMAGE.length) - 1];
    const boosted = used[winner] === "power";
    if (boosted) damage *= 2;

    if (used[loser] === "shield") {
      this.streak = [0, 0];
      return { result: "blocked", winner, loser, hurt: -1, damage: 0, blocked: damage, combo, forfeit, boosted, used };
    }
    const reversed = used[loser] === "reverse";
    const hurt = reversed ? winner : loser;
    if (reversed) this.streak = [0, 0];
    else {
      this.streak[winner] = combo;
      this.streak[loser] = 0;
    }
    this.hp[hurt] = Math.max(0, this.hp[hurt] - damage);

    const ev = { result: "hit", winner, loser, hurt, damage, combo: reversed ? 1 : combo, forfeit, boosted, reversed, used, ko: false };
    if (this.hp[hurt] === 0) {
      const victor = 1 - hurt;
      ev.ko = true;
      ev.victor = victor;
      ev.perfect = this.hp[victor] === MAX_HP;
      this.roundWinner = victor;
      this.roundWins[victor]++;
      if (this.roundWins[victor] >= ROUNDS_TO_WIN) {
        this.matchWinner = victor;
        ev.matchOver = true;
      }
    }
    return ev;
  }
}
