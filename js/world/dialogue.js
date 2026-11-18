// Dialogue box for the school: portrait, name, trait chip, text that types out, and choices.
// Everything is a real button, so tap, click, keys and the hand cursor all work.

const CHARS_PER_S = 60;

export class Dialogue {
  /** els: { box, face, name, trait, text, next, choices }. onBlip: called now and then while text types. */
  constructor(els, { onBlip = () => {} } = {}) {
    this.e = els;
    this.onBlip = onBlip;
    this.resolveLine = null;
    this.typing = null;
    els.box.addEventListener("click", (ev) => {
      if (ev.target.closest(".talk-choices")) return;
      this.advance();
    });
  }

  get open() {
    return !this.e.box.hidden;
  }

  /**
   * Show lines one by one. With `choices`, the last line waits for a choice and its index is returned;
   * otherwise resolves with null after the last line.
   * speaker: { name, emoji, trait? }
   */
  async say(speaker, lines, choices = null) {
    const e = this.e;
    if (speaker.portrait) e.face.replaceChildren(speaker.portrait);
    else e.face.textContent = speaker.emoji || "💬";
    this.skipNow = false;
    e.name.textContent = speaker.name || "";
    e.trait.textContent = speaker.trait || "";
    e.trait.hidden = !speaker.trait;
    e.box.hidden = false;
    let picked = null;
    for (let i = 0; i < lines.length; i++) {
      const last = i === lines.length - 1;
      if (this.skipNow && !(last && choices)) continue;
      await this.type(lines[i]);
      if (last && choices) picked = await this.choose(choices);
      else await this.waitNext();
    }
    e.box.hidden = true;
    e.choices.innerHTML = "";
    return picked;
  }

  type(text) {
    const e = this.e;
    if (this.skipNow) {
      e.text.textContent = text;
      return Promise.resolve();
    }
    e.choices.innerHTML = "";
    e.choices.hidden = true;
    e.next.hidden = true;
    return new Promise((done) => {
      const t0 = performance.now();
      let shown = 0;
      const finish = () => {
        cancelAnimationFrame(this.typing?.raf);
        this.typing = null;
        e.text.textContent = text;
        done();
      };
      const tick = (now) => {
        const n = Math.min(text.length, Math.floor(((now - t0) / 1000) * CHARS_PER_S));
        if (n !== shown) {
          if (Math.floor(n / 4) !== Math.floor(shown / 4)) this.onBlip();
          shown = n;
          e.text.textContent = text.slice(0, n);
        }
        if (n >= text.length) return finish();
        this.typing.raf = requestAnimationFrame(tick);
      };
      this.typing = { finish, raf: requestAnimationFrame(tick) };
    });
  }

  waitNext() {
    if (this.skipNow) return Promise.resolve();
    this.e.next.hidden = false;
    return new Promise((r) => (this.resolveLine = r));
  }

  choose(choices) {
    const e = this.e;
    e.choices.hidden = false;
    return new Promise((r) => {
      e.choices.innerHTML = "";
      choices.forEach((label, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `btn${i === 0 ? " primary" : ""}`;
        b.textContent = label;
        b.addEventListener("click", () => r(i));
        e.choices.appendChild(b);
      });
      e.choices.firstChild?.focus({ preventScroll: true });
    });
  }

  /** Tap / Space / Enter: finish typing, or go to the next line. Choices need their own button. */
  advance() {
    if (this.typing) return this.typing.finish();
    if (this.resolveLine && !this.e.next.hidden) {
      const r = this.resolveLine;
      this.resolveLine = null;
      this.e.next.hidden = true;
      r();
    }
  }

  /** Skip button: drop the rest of these lines (a choice at the end still shows). */
  skipLines() {
    this.skipNow = true;
    this.advance();
    this.advance();
  }

  /** Arrow keys move between choices. */
  moveChoice(delta) {
    const btns = [...this.e.choices.querySelectorAll("button")];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    btns[(i + delta + btns.length) % btns.length].focus({ preventScroll: true });
  }

  get choosing() {
    return !this.e.choices.hidden && this.e.choices.children.length > 0;
  }
}
