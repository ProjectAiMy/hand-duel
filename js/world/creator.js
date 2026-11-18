// Avatar creator: name, skin, hair, outfit, hat and extra, with colours. Opened at the start of the story
// and from your locker, where coin items can be bought. Locked items say how to earn them.
import { SKINS, COLORS, itemsIn, owned, lockOf, lockText, normalizeAvatar, ownedOnly, avatarCanvas, currentPack } from "../art/avatar.js";

const TABS = [
  { slot: "skin", label: "Skin" },
  { slot: "hair", label: "Hair", color: "hairColor" },
  { slot: "top", label: "Top", color: "topColor" },
  { slot: "bottom", label: "Bottom", color: "bottomColor" },
  { slot: "hat", label: "Hat", color: "hatColor" },
  { slot: "extra", label: "Extra", color: "extraColor" },
];
const DIRS = ["down", "left", "up", "right"];

export class Creator {
  /** root: where to put the panel. hooks: { save(), persist(), sfx } */
  constructor(root, hooks) {
    this.h = hooks;
    this.el = document.createElement("div");
    this.el.className = "modal creator";
    this.el.id = "creator";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-labelledby", "crTitle");
    this.el.innerHTML = `
      <div class="card glass creator-card">
        <h2 id="crTitle">Your look</h2>
        <div class="creator-grid">
          <div class="creator-preview">
            <canvas class="cr-big" aria-label="Preview"></canvas>
            <button type="button" class="btn small" data-turn>↻ Turn</button>
            <p class="cr-coins"></p>
          </div>
          <div class="creator-edit">
            <label class="cr-name">Name <input type="text" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name"></label>
            <div class="cr-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.slot}">${t.label}</button>`).join("")}</div>
            <div class="cr-items"></div>
            <div class="cr-colors"></div>
            <p class="cr-msg" role="status"></p>
          </div>
        </div>
        <div class="cta-row center">
          <button type="button" class="btn" data-random>🎲 Random</button>
          <button type="button" class="btn primary" data-done>Done</button>
        </div>
      </div>`;
    root.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.big = q(".cr-big");
    this.items = q(".cr-items");
    this.colors = q(".cr-colors");
    this.msg = q(".cr-msg");
    this.name = q(".cr-name input");
    this.coins = q(".cr-coins");
    this.el.addEventListener("click", (e) => this.onClick(e));
  }

  get open() {
    return !this.el.hidden;
  }

  /** Resolves with { avatar, name } when Done is pressed. */
  edit({ title = "Your look", shop = false } = {}) {
    const save = this.h.save();
    this.shop = shop;
    this.avatar = ownedOnly(normalizeAvatar(save.avatar || {}), save);
    this.name.value = save.name || "";
    this.el.querySelector("#crTitle").textContent = title;
    this.tab = "hair";
    this.dir = 0;
    this.frame = 0;
    this.armed = null;
    this.msg.textContent = shop ? "Coin items can be bought here at your locker." : "";
    this.el.hidden = false;
    this.render();
    clearInterval(this.anim);
    this.anim = setInterval(() => {
      this.frame = (this.frame + 1) % 4;
      this.drawPreview();
    }, 220);
    return new Promise((r) => (this.done = r));
  }

  close() {
    clearInterval(this.anim);
    this.el.hidden = true;
    const save = this.h.save();
    save.avatar = this.avatar;
    save.name = this.name.value.replace(/[^\p{L}\p{N} ._'-]/gu, "").trim().slice(0, 16);
    this.h.persist();
    this.done?.({ avatar: this.avatar, name: save.name });
  }

  onClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.done !== undefined) return this.close();
    if (b.dataset.turn !== undefined) {
      this.dir = (this.dir + 1) % 4;
      return this.drawPreview();
    }
    if (b.dataset.random !== undefined) return this.randomize();
    if (b.dataset.tab) {
      this.tab = b.dataset.tab;
      return this.render();
    }
    if (b.dataset.skin) {
      this.avatar.skin = Number(b.dataset.skin);
      return this.render();
    }
    if (b.dataset.color) {
      this.avatar[b.dataset.key] = b.dataset.color;
      return this.render();
    }
    if (b.dataset.item) return this.pick(b.dataset.item);
  }

  pick(id) {
    const save = this.h.save();
    const slot = this.tab;
    if (owned(slot, id, save)) {
      this.avatar[slot] = id;
      this.armed = null;
      this.msg.textContent = "";
      return this.render();
    }
    const lock = lockOf(slot, id);
    if (!lock.coins) return void (this.msg.textContent = `🔒 ${lockText(slot, id)}.`);
    if (!this.shop) return void (this.msg.textContent = `🔒 Buy it for ${lock.coins} coins at your locker in the corridor.`);
    if (save.coins < lock.coins) return void (this.msg.textContent = `🔒 Costs ${lock.coins} coins. You have ${save.coins}. Win duels to earn more.`);
    const key = `${slot}:${id}`;
    if (this.armed !== key) {
      this.armed = key;
      return void (this.msg.textContent = `Buy for ${lock.coins} coins? Tap it again to buy.`);
    }
    save.coins -= lock.coins;
    save.items.push(key);
    this.armed = null;
    this.avatar[slot] = id;
    this.h.persist();
    this.h.sfx?.arm?.();
    this.msg.textContent = `Bought! ${save.coins} coins left.`;
    this.render();
  }

  randomize() {
    const save = this.h.save();
    const any = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const a = { ...this.avatar, skin: Math.floor(Math.random() * SKINS.length) };
    for (const t of TABS.slice(1)) {
      a[t.slot] = any(itemsIn(t.slot).filter((it) => owned(t.slot, it.id, save))).id;
      a[t.color] = any(COLORS);
    }
    this.avatar = normalizeAvatar(a);
    this.render();
  }

  render() {
    const save = this.h.save();
    this.el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === this.tab)));
    this.coins.textContent = `🪙 ${save.coins} coins`;
    const t = TABS.find((x) => x.slot === this.tab);
    if (t.slot === "skin") {
      this.items.innerHTML = SKINS.map(
        (c, i) => `<button type="button" class="cr-swatch big${this.avatar.skin === i ? " on" : ""}" data-skin="${i}" style="background:${c}" aria-label="Skin tone ${i + 1}"></button>`,
      ).join("");
      this.colors.innerHTML = "";
    } else {
      this.items.innerHTML = "";
      for (const it of itemsIn(t.slot)) {
        const mine = owned(t.slot, it.id, save);
        const b = document.createElement("button");
        b.type = "button";
        b.className = `cr-item${this.avatar[t.slot] === it.id ? " on" : ""}${mine ? "" : " locked"}`;
        b.dataset.item = it.id;
        b.title = mine ? it.name : `${it.name}: ${lockText(t.slot, it.id)}`;
        b.appendChild(avatarCanvas({ ...this.avatar, [t.slot]: it.id }, { scale: 3 }));
        const label = document.createElement("span");
        const lock = lockOf(t.slot, it.id);
        label.textContent = mine ? it.name : lock?.coins ? `🔒 ${lock.coins}🪙` : "🔒";
        b.appendChild(label);
        this.items.appendChild(b);
      }
      this.colors.innerHTML = COLORS.map(
        (c) => `<button type="button" class="cr-swatch${this.avatar[t.color] === c ? " on" : ""}" data-key="${t.color}" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`,
      ).join("");
    }
    this.drawPreview();
  }

  drawPreview() {
    const frames = currentPack().frames;
    const f = [0, 1, 0, 2][this.frame] % frames;
    avatarCanvas(this.avatar, { face: DIRS[this.dir], frame: f, scale: 8, canvas: this.big });
  }
}
