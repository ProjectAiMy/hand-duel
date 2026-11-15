// Fighting-game rules on top of Rock-Paper-Scissors. Pure logic, no DOM, so it's
// deterministic: online, both devices run the same exchanges and stay in sync.
import { outcome } from "./gesture.js";

export const MAX_HP = 100;
export const ROUNDS_TO_WIN = 2; // best of 3 rounds
// Damage by win streak: 1st hit, 2nd in a row, 3rd+ in a row. Three straight wins = K.O.
export const DAMAGE = [25, 35, 45];

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
    this.roundWinner = null;
  }

  nextRound() {
    this.round++;
    this.newRound();
  }

  /** Plain copy of the state, for the online host to send as the source of truth. */
  snapshot() {
    const { round, roundWins, hp, streak, roundWinner, matchWinner } = this;
    return { round, roundWins: [...roundWins], hp: [...hp], streak: [...streak], roundWinner, matchWinner };
  }

  /** Load a snapshot; mirror=true swaps sides (the guest sees itself on the left). */
  restore(s, mirror = false) {
    const pair = (a) => (mirror ? [a[1], a[0]] : [...a]);
    const side = (x) => (x === null || x === undefined ? null : mirror ? 1 - x : x);
    this.round = s.round;
    this.roundWins = pair(s.roundWins);
    this.hp = pair(s.hp);
    this.streak = pair(s.streak);
    this.roundWinner = side(s.roundWinner);
    this.matchWinner = side(s.matchWinner);
  }

  /**
   * Resolve one throw. Side 0 = left player, side 1 = right player.
   * A missing throw (null) loses to any real throw ("too slow"); two misses are void.
   */
  exchange(a, b) {
    if (this.matchWinner !== null || this.roundWinner !== null) throw new Error("round is over");
    if (!a && !b) return { result: "void", winner: -1, damage: 0 };

    let winner;
    if (a && !b) winner = 0;
    else if (!a && b) winner = 1;
    else {
      const o = outcome(a, b);
      winner = o === "win" ? 0 : o === "lose" ? 1 : -1;
    }
    if (winner === -1) {
      this.streak = [0, 0];
      return { result: "draw", winner: -1, damage: 0 };
    }

    const loser = 1 - winner;
    this.streak[winner]++;
    this.streak[loser] = 0;
    const combo = this.streak[winner];
    const damage = DAMAGE[Math.min(combo, DAMAGE.length) - 1];
    this.hp[loser] = Math.max(0, this.hp[loser] - damage);

    const ev = { result: "hit", winner, loser, damage, combo, forfeit: !a || !b, ko: false };
    if (this.hp[loser] === 0) {
      ev.ko = true;
      ev.perfect = this.hp[winner] === MAX_HP;
      this.roundWinner = winner;
      this.roundWins[winner]++;
      if (this.roundWins[winner] >= ROUNDS_TO_WIN) {
        this.matchWinner = winner;
        ev.matchOver = true;
      }
    }
    return ev;
  }
}
