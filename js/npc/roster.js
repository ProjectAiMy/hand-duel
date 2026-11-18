// The cast you can duel in VS CPU (and, later, meet at school). Each `strategy` is a spec for
// js/npc/strategy.js. Values are first guesses, to be tuned by playing.
// short: name for the score bar (defaults to name). lines: what they say after a school duel (beaten = you won). stars: rough difficulty 1-5. hint: shown on Easy only. Names are placeholders for the story.

const AV = {
  rio: {"skin": 3, "hair": "spiky", "hairColor": "#ea580c", "top": "hoodie", "topColor": "#f97316", "bottom": "trousers", "bottomColor": "#292524", "hat": "none", "extra": "scarf", "extraColor": "#111827"},
  ren: {"skin": 0, "hair": "short", "hairColor": "#e5e7eb", "top": "uniform", "topColor": "#1e293b", "bottom": "trousers", "bottomColor": "#0f172a", "hat": "none", "extra": "scarf", "extraColor": "#ffcc33"},
};

export const ROSTER = [
  {
    id: "cpu", group: "more", name: "CPU", title: "Classic practice bot", trait: "Random", emoji: "🤖", stars: 2,
    avatar: {"skin": 0, "hair": "buzz", "hairColor": "#9ca3af", "top": "vest", "topColor": "#64748b", "bottom": "trousers", "bottomColor": "#334155", "hat": "none", "extra": "glasses"},
    intro: "Beep. Ready when you are.",
    lines: { beaten: "Beep. Recalibrating.", won: "Beep. Victory logged." },
    hint: "No habits at all: every throw is a coin flip.",
    strategy: { behaviours: [{ type: "random" }], noise: 1, powers: "sometimes" },
  },
  // ---------- classmates and staff ----------
  {
    id: "pip", group: "classmates", name: "Pip", title: "First-year", trait: "Eager", emoji: "🧢", stars: 1,
    avatar: {"skin": 1, "hair": "spiky", "hairColor": "#f0b429", "top": "tee", "topColor": "#e5484d", "bottom": "shorts", "bottomColor": "#3b82f6", "hat": "cap", "hatColor": "#e5484d", "extra": "bandage"},
    intro: "Rock is the strongest! I ALWAYS start with rock!",
    lines: { beaten: "Rock… isn't the strongest? Huh.", won: "Told you! Rock is the strongest!" },
    hint: "Pip opens every round with rock, and likes rock after that too.",
    strategy: { bias: { rock: 0.45, paper: 0.275, scissors: 0.275 }, behaviours: [{ type: "opener", g: "rock" }], noise: 0.35, powers: "sometimes" },
  },
  {
    id: "bea", group: "classmates", name: "Bea", title: "Runs the bake sale", trait: "Nervous", emoji: "🧁", stars: 1,
    avatar: {"skin": 0, "hair": "bob", "hairColor": "#c2410c", "top": "uniform", "topColor": "#f472b6", "bottom": "skirt", "bottomColor": "#7c2d55", "hat": "bow", "hatColor": "#ffffff", "extra": "none"},
    intro: "Oh! A duel? Oh no, oh no… okay!",
    lines: { beaten: "Oh! Well done! Want a cupcake anyway?", won: "Oh! I won? Oh no, sorry! Cupcake?" },
    hint: "Bea repeats a throw that just won, and panics into paper after losing.",
    strategy: { behaviours: [{ type: "winStay", w: 0.8 }, { type: "fixed", g: "paper", when: "afterLoss", w: 0.75 }], noise: 0.3, powers: "never" },
    tell: { before: "paper", text: "“Oh no, oh no…”", chance: 0.8, falseChance: 0.1 },
  },
  {
    id: "ruth", group: "classmates", name: "Ms. Ruth", short: "Ruth", title: "Music teacher", trait: "Rhythmic", emoji: "🎵", stars: 2,
    avatar: {"skin": 2, "hair": "bun", "hairColor": "#6b7280", "top": "jacket", "topColor": "#0f766e", "bottom": "skirt", "bottomColor": "#134e4a", "hat": "none", "extra": "glasses"},
    intro: "Everything has a rhythm, dear. Even this.",
    lines: { beaten: "You broke my rhythm. Lovely.", won: "Practice your scales, dear." },
    hint: "Ms. Ruth goes rock → paper → scissors → rock… in order.",
    strategy: { behaviours: [{ type: "cycle", w: 0.9 }], noise: 0.2, powers: "never" },
    tell: { before: "rock", text: "♪ Hums the first note…", chance: 0.6, falseChance: 0.05 },
  },
  {
    id: "tank", group: "classmates", name: "Coach Tank", short: "Tank", title: "PE teacher", trait: "Loud", emoji: "📣", stars: 2,
    avatar: {"skin": 4, "hair": "buzz", "hairColor": "#111827", "top": "tee", "topColor": "#dc2626", "bottom": "shorts", "bottomColor": "#111827", "hat": "cap", "hatColor": "#111827", "extra": "none"},
    intro: "GIVE ME ONE HUNDRED PERCENT!",
    lines: { beaten: "NOW THAT'S ONE HUNDRED PERCENT!", won: "TEN LAPS! Kidding. Mostly." },
    hint: "Coach Tank fires every power-up the moment he has one, and leans on rock.",
    strategy: { bias: { rock: 0.42, paper: 0.29, scissors: 0.29 }, behaviours: [{ type: "winStay", w: 0.4 }], noise: 0.4, powers: "always" },
  },
  {
    id: "dex", group: "classmates", name: "Dex", title: "Games club regular", trait: "Show-off", emoji: "🎮", stars: 3,
    avatar: {"skin": 1, "hair": "spiky", "hairColor": "#14532d", "top": "hoodie", "topColor": "#16a34a", "bottom": "trousers", "bottomColor": "#1f2937", "hat": "none", "extra": "glasses"},
    intro: "I've already got your number. Watch.",
    lines: { beaten: "Lag. That was lag.", won: "Called it. I always call it." },
    hint: "Dex throws whatever beats the throw you've used most this match.",
    strategy: { behaviours: [{ type: "counterFavourite", w: 0.75 }], noise: 0.3, powers: "sometimes" },
  },
  {
    id: "luna", group: "classmates", name: "Luna", title: "Astronomy club", trait: "Mysterious", emoji: "🔮", stars: 3,
    avatar: {"skin": 5, "hair": "long", "hairColor": "#2b2350", "top": "hoodie", "topColor": "#6e56cf", "bottom": "skirt", "bottomColor": "#312e81", "hat": "none", "extra": "star"},
    intro: "The stars haven't decided yet. Neither have I.",
    lines: { beaten: "The stars favoured you today.", won: "The stars favoured me. Or did they?" },
    hint: "Luna is truly random. There's no pattern to find, so just play your best.",
    strategy: { behaviours: [{ type: "random" }], noise: 1, powers: "sometimes" },
  },
  // ---------- club captains ----------
  {
    id: "granite", group: "captains", twist: "doubleShield", name: "Granite", title: "Captain, Stone Club", trait: "Stubborn", emoji: "🪨", stars: 2,
    avatar: {"skin": 3, "hair": "buzz", "hairColor": "#1f2937", "top": "gi", "topColor": "#8a8fa8", "bottom": "hakama", "bottomColor": "#374151", "hat": "band", "hatColor": "#e5484d", "extra": "none"},
    intro: "Stone does not move. Neither do I.",
    lines: { beaten: "…A crack. Well done.", won: "Solid." },
    hint: "Granite loves rock, repeats a winning throw, and gets even more stubborn when ahead.",
    strategy: {
      bias: { rock: 0.5, paper: 0.25, scissors: 0.25 }, behaviours: [{ type: "winStay", w: 0.7 }], noise: 0.25,
      mood: [{ when: "ahead", bias: { rock: 0.7, paper: 0.15, scissors: 0.15 } }], powers: "whenBehind",
    },
    tell: { before: "rock", text: "*cracks knuckles*", chance: 0.7, falseChance: 0.1 },
  },
  {
    id: "fold", group: "captains", twist: "earlyReverse", name: "Fold", title: "Captain, Origami Club", trait: "Patient", emoji: "📄", stars: 3,
    avatar: {"skin": 0, "hair": "ponytail", "hairColor": "#111827", "top": "gi", "topColor": "#f5f5f4", "bottom": "hakama", "bottomColor": "#1e3a8a", "hat": "none", "extra": "none"},
    intro: "Patience folds every crane. Shall we?",
    lines: { beaten: "A fine fold. I bow to you.", won: "Patience wins again." },
    hint: "Fold never throws the same thing twice in a row, and prefers paper.",
    strategy: { bias: { rock: 0.28, paper: 0.44, scissors: 0.28 }, masks: ["noRepeat"], noise: 0.15, powers: "sometimes" },
    tell: { before: "paper", text: "*bows deeply*", chance: 0.6, falseChance: 0.15 },
  },
  {
    id: "snip", group: "captains", twist: "speed", name: "Snip", title: "Captain, Fencing Club", trait: "Hot-headed", emoji: "🤺", stars: 3,
    avatar: {"skin": 2, "hair": "spiky", "hairColor": "#b91c1c", "top": "jacket", "topColor": "#f8fafc", "bottom": "trousers", "bottomColor": "#f8fafc", "hat": "band", "hatColor": "#b91c1c", "extra": "none"},
    intro: "En garde! I don't lose twice to the same move.",
    lines: { beaten: "Touché! I'll remember that one.", won: "En garde next time!" },
    hint: "After losing, Snip throws whatever beats your last throw.",
    strategy: {
      bias: { rock: 0.3, paper: 0.3, scissors: 0.4 },
      behaviours: [{ type: "winStay", w: 0.5 }, { type: "counterLast", when: "afterLoss", w: 0.85 }], noise: 0.2, powers: "sometimes",
    },
  },
  {
    id: "echo", group: "captains", twist: "mirror", name: "Echo", title: "Captain, Drama Club", trait: "Copycat", emoji: "🎭", stars: 4,
    avatar: {"skin": 1, "hair": "bob", "hairColor": "#a855f7", "top": "jacket", "topColor": "#4c1d95", "bottom": "trousers", "bottomColor": "#1e1b4b", "hat": "none", "extra": "cape", "extraColor": "#a855f7"},
    intro: "Every great actor starts by copying. Show me yours.",
    lines: { beaten: "Bravo! An original performance.", won: "You were a wonderful mirror." },
    hint: "Echo copies your last throw. Below half health, Echo expects you to beat the copy, and beats that.",
    strategy: {
      behaviours: [{ type: "copy", w: 0.8 }], noise: 0.2, powers: "sometimes",
      mood: [{ when: "lowHp", replace: [{ type: "counterCounter", w: 0.8 }] }],
    },
  },
  {
    id: "ren", group: "captains", name: "Ren", title: "Student Council President", trait: "Reader", emoji: "👑", stars: 5,
    avatar: {"skin": 0, "hair": "short", "hairColor": "#e5e7eb", "top": "uniform", "topColor": "#1e293b", "bottom": "trousers", "bottomColor": "#0f172a", "hat": "none", "extra": "scarf", "extraColor": "#ffcc33"},
    intro: "I've read every duel you've had today. Begin.",
    lines: { beaten: "Interesting. I didn't read that.", won: "As expected." },
    hint: "Ren learns what you throw after your last two throws. Break your own patterns.",
    strategy: { behaviours: [{ type: "markov", order: 2, w: 0.75 }], noise: 0.2, powers: "whenBehind" },
  },
  // ---------- rival ----------
  {
    id: "rio", group: "more", name: "Rio", title: "Your rival", trait: "Adaptive", emoji: "🔥", stars: 4,
    avatar: {"skin": 3, "hair": "spiky", "hairColor": "#ea580c", "top": "hoodie", "topColor": "#f97316", "bottom": "trousers", "bottomColor": "#292524", "hat": "none", "extra": "scarf", "extraColor": "#111827"},
    intro: "I remember every duel we've had. Every single one.",
    lines: { beaten: "That one doesn't count. Again!", won: "I told you I'd remember." },
    hint: "Rio studies your throws from past matches too, not just this one.",
    strategy: { useMemory: true, behaviours: [{ type: "counterFavourite", w: 0.4 }, { type: "markov", order: 1, w: 0.6 }], noise: 0.25, powers: "whenBehind" },
  },
  // ---------- story only (school mode; not in the VS CPU picker) ----------
  {
    id: "rio0", group: "story", name: "Rio", title: "Transfer student", trait: "Cocky", emoji: "🔥", stars: 1,
    avatar: AV.rio,
    intro: "First day, first duel. Rock beats everything, watch!",
    lines: { beaten: "Beginner's luck. Next time's mine!", won: "Ha! See? Rock beats everything." },
    hint: "Rio opens with rock and keeps leaning on it.",
    strategy: { bias: { rock: 0.5, paper: 0.25, scissors: 0.25 }, behaviours: [{ type: "opener", g: "rock" }], noise: 0.45, powers: "never" },
  },
  member("cobble", "Cobble", "Stone Club", "Solid", "🪨", {
    bias: { rock: 0.5, paper: 0.25, scissors: 0.25 }, behaviours: [{ type: "winStay", w: 0.4 }], noise: 0.45,
    intro: "Rocks don't think. Neither do I!", beaten: "…I should have thought.", won: "Rock solid.",
    hint: "Cobble likes rock, and repeats a win.",
    avatar: { skin: 2, hair: "buzz", hairColor: "#4b5563", top: "gi", topColor: "#9ca3af", bottom: "hakama", bottomColor: "#4b5563" },
  }),
  member("flint", "Flint", "Stone Club", "Sparky", "🔥", {
    bias: { rock: 0.45, paper: 0.27, scissors: 0.28 }, behaviours: [{ type: "winStay", w: 0.6 }], noise: 0.4,
    intro: "Granite says I'm almost ready. Let's see!", beaten: "Sparks, but no fire. Well played.", won: "Strike!",
    hint: "Flint leans on rock and repeats a win.",
    avatar: { skin: 1, hair: "short", hairColor: "#7c2d12", top: "gi", topColor: "#9ca3af", bottom: "hakama", bottomColor: "#4b5563" },
    tell: { before: "rock", text: "*cracks knuckles*", chance: 0.5, falseChance: 0.15 },
  }),
  member("crane", "Crane", "Origami Club", "Neat", "🕊️", {
    bias: { rock: 0.27, paper: 0.46, scissors: 0.27 }, masks: ["noRepeat"], noise: 0.45,
    intro: "Every fold in its place. Every throw too.", beaten: "My folds came undone.", won: "Crisp.",
    hint: "Crane likes paper and never repeats a throw.",
    avatar: { skin: 0, hair: "bob", hairColor: "#111827", top: "vest", topColor: "#93c5fd", bottom: "skirt", bottomColor: "#1e3a8a" },
  }),
  member("inkwell", "Inkwell", "Origami Club", "Tidy", "🖋️", {
    behaviours: [{ type: "cycle", w: 0.4 }], masks: ["noRepeat"], noise: 0.35,
    intro: "Shh. This is a library. Duel quietly.", beaten: "Noted. In ink.", won: "Filed under: wins.",
    hint: "Inkwell never repeats, and often goes rock → paper → scissors.",
    avatar: { skin: 3, hair: "short", hairColor: "#1f2937", top: "vest", topColor: "#1e3a8a", bottom: "trousers", bottomColor: "#1f2937", extra: "glasses" },
  }),
  member("parry", "Parry", "Fencing Club", "Quick", "🗡️", {
    behaviours: [{ type: "winStay", w: 0.4 }, { type: "counterLast", when: "afterLoss", w: 0.6 }], noise: 0.4,
    intro: "Snip says I'm too slow. Am I?", beaten: "Touché.", won: "Too slow!",
    hint: "After losing, Parry throws what beats your last throw.",
    avatar: { skin: 4, hair: "short", hairColor: "#111827", top: "jacket", topColor: "#f8fafc", bottom: "trousers", bottomColor: "#e5e7eb" },
  }),
  member("riposte", "Riposte", "Fencing Club", "Sharp", "⚔️", {
    bias: { rock: 0.28, paper: 0.27, scissors: 0.45 }, behaviours: [{ type: "counterLast", when: "afterLoss", w: 0.5 }], noise: 0.4,
    intro: "Scissors are a blade. Blades win.", beaten: "My blade went dull.", won: "Snip!",
    hint: "Riposte likes scissors, and counters your last throw after losing.",
    avatar: { skin: 1, hair: "ponytail", hairColor: "#f0b429", top: "jacket", topColor: "#f8fafc", bottom: "trousers", bottomColor: "#e5e7eb" },
  }),
  member("mime", "Mime", "Drama Club", "Silent", "🤐", {
    behaviours: [{ type: "copy", w: 0.55 }], noise: 0.4,
    intro: "… (mimes a duel)", beaten: "… (bows)", won: "… (takes a bow)",
    hint: "Mime copies your last throw.",
    avatar: { skin: 0, hair: "short", hairColor: "#111827", top: "tee", topColor: "#ffffff", bottom: "trousers", bottomColor: "#111827", hat: "beanie", hatColor: "#111827" },
  }),
  member("cue", "Cue", "Drama Club", "Dramatic", "🎬", {
    behaviours: [{ type: "copy", w: 0.6 }], noise: 0.35, mood: [{ when: "lowHp", replace: [{ type: "counterCounter", w: 0.5 }] }],
    intro: "Places, everyone! This is my big scene!", beaten: "Cut! That wasn't in the script!", won: "And… scene!",
    hint: "Cue copies your last throw. Low on health, Cue beats the throw that beats the copy.",
    avatar: { skin: 2, hair: "long", hairColor: "#be185d", top: "jacket", topColor: "#7c3aed", bottom: "skirt", bottomColor: "#1e1b4b" },
  }),
  member("vale", "Vale", "Council Secretary", "Precise", "📋", {
    behaviours: [{ type: "markov", order: 1, w: 0.5 }], noise: 0.4,
    intro: "The Council has a file on you. It's thin.", beaten: "I'll update the file.", won: "As recorded.",
    hint: "Vale learns what you throw after each throw.",
    avatar: { skin: 1, hair: "bob", hairColor: "#374151", top: "uniform", topColor: "#1e293b", bottom: "skirt", bottomColor: "#0f172a", extra: "glasses" },
  }),
  member("quill", "Quill", "Council Treasurer", "Counting", "🪙", {
    behaviours: [{ type: "counterFavourite", w: 0.55 }], noise: 0.35,
    intro: "I've counted your throws. All of them.", beaten: "My numbers were off.", won: "The numbers never lie.",
    hint: "Quill throws what beats your most-used throw.",
    avatar: { skin: 4, hair: "short", hairColor: "#111827", top: "uniform", topColor: "#1e293b", bottom: "trousers", bottomColor: "#0f172a" },
  }),
  {
    id: "ren2", group: "story", name: "Ren", title: "Student Council President", trait: "Unmasked", emoji: "👑", stars: 5, twist: "bestOf5",
    avatar: { ...AV.ren, extra: "cape", extraColor: "#ffcc33" },
    intro: "Enough reading. Now I play to win.",
    lines: { beaten: "…Duels stay. You've earned that.", won: "Lotteries are fairer than this. Again, if you dare." },
    hint: "Ren now mixes reading your last two throws with countering your favourite. Change it up every throw.",
    strategy: { behaviours: [{ type: "markov", order: 2, w: 0.6 }, { type: "counterFavourite", w: 0.3 }], noise: 0.15, powers: "whenBehind" },
  },
];

/** A club or Council member: a weaker version of their captain's style, to practise reading it first. */
function member(id, name, title, trait, emoji, o) {
  const e = {
    id, group: "story", name, title, trait, emoji, stars: 2, avatar: o.avatar,
    intro: o.intro, lines: { beaten: o.beaten, won: o.won }, hint: o.hint,
    strategy: { bias: o.bias, behaviours: o.behaviours || [], masks: o.masks || [], mood: o.mood || [], noise: o.noise, powers: "sometimes" },
  };
  if (o.tell) e.tell = o.tell;
  return e;
}

/** Club twists: how a captain changes the rules of a duel (school mode). */
export const TWISTS = {
  doubleShield: { label: "Twist: Granite's shield blocks two hits", rules: { extraShields: [0, 1] } },
  earlyReverse: { label: "Twist: Fold starts every round holding Reverse", rules: { startPowers: [[], ["reverse"]] } },
  speed: { label: "Twist: speed rounds, a faster countdown", beat: 330 },
  mirror: { label: "Twist: your last throw stays on the floor", showLast: true },
  bestOf5: { label: "Twist: best of 5 rounds", rules: { roundsToWin: 3 } },
};

export const GROUPS = [
  { id: "classmates", label: "Classmates & staff" },
  { id: "captains", label: "Club captains" },
  { id: "more", label: "Your rival · practice bot" },
];

export const byId = (id) => ROSTER.find((n) => n.id === id) || ROSTER[0];
