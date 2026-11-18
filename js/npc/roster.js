// The cast you can duel in VS CPU (and, later, meet at school). Each `strategy` is a spec for
// js/npc/strategy.js. Values are first guesses, to be tuned by playing.
// short: name for the score bar (defaults to name). lines: what they say after a school duel (beaten = you won). stars: rough difficulty 1-5. hint: shown on Easy only. Names are placeholders for the story.

export const ROSTER = [
  {
    id: "cpu", group: "more", name: "CPU", title: "Classic practice bot", trait: "Random", emoji: "🤖", stars: 2,
    intro: "Beep. Ready when you are.",
    lines: { beaten: "Beep. Recalibrating.", won: "Beep. Victory logged." },
    hint: "No habits at all: every throw is a coin flip.",
    strategy: { behaviours: [{ type: "random" }], noise: 1, powers: "sometimes" },
  },
  // ---------- classmates and staff ----------
  {
    id: "pip", group: "classmates", name: "Pip", title: "First-year", trait: "Eager", emoji: "🧢", stars: 1,
    intro: "Rock is the strongest! I ALWAYS start with rock!",
    lines: { beaten: "Rock… isn't the strongest? Huh.", won: "Told you! Rock is the strongest!" },
    hint: "Pip opens every round with rock, and likes rock after that too.",
    strategy: { bias: { rock: 0.45, paper: 0.275, scissors: 0.275 }, behaviours: [{ type: "opener", g: "rock" }], noise: 0.35, powers: "sometimes" },
  },
  {
    id: "bea", group: "classmates", name: "Bea", title: "Runs the bake sale", trait: "Nervous", emoji: "🧁", stars: 1,
    intro: "Oh! A duel? Oh no, oh no… okay!",
    lines: { beaten: "Oh! Well done! Want a cupcake anyway?", won: "Oh! I won? Oh no, sorry! Cupcake?" },
    hint: "Bea repeats a throw that just won, and panics into paper after losing.",
    strategy: { behaviours: [{ type: "winStay", w: 0.8 }, { type: "fixed", g: "paper", when: "afterLoss", w: 0.75 }], noise: 0.3, powers: "never" },
    tell: { before: "paper", text: "“Oh no, oh no…”", chance: 0.8, falseChance: 0.1 },
  },
  {
    id: "ruth", group: "classmates", name: "Ms. Ruth", short: "Ruth", title: "Music teacher", trait: "Rhythmic", emoji: "🎵", stars: 2,
    intro: "Everything has a rhythm, dear. Even this.",
    lines: { beaten: "You broke my rhythm. Lovely.", won: "Practice your scales, dear." },
    hint: "Ms. Ruth goes rock → paper → scissors → rock… in order.",
    strategy: { behaviours: [{ type: "cycle", w: 0.9 }], noise: 0.2, powers: "never" },
    tell: { before: "rock", text: "♪ Hums the first note…", chance: 0.6, falseChance: 0.05 },
  },
  {
    id: "tank", group: "classmates", name: "Coach Tank", short: "Tank", title: "PE teacher", trait: "Loud", emoji: "📣", stars: 2,
    intro: "GIVE ME ONE HUNDRED PERCENT!",
    lines: { beaten: "NOW THAT'S ONE HUNDRED PERCENT!", won: "TEN LAPS! Kidding. Mostly." },
    hint: "Coach Tank fires every power-up the moment he has one, and leans on rock.",
    strategy: { bias: { rock: 0.42, paper: 0.29, scissors: 0.29 }, behaviours: [{ type: "winStay", w: 0.4 }], noise: 0.4, powers: "always" },
  },
  {
    id: "dex", group: "classmates", name: "Dex", title: "Games club regular", trait: "Show-off", emoji: "🎮", stars: 3,
    intro: "I've already got your number. Watch.",
    lines: { beaten: "Lag. That was lag.", won: "Called it. I always call it." },
    hint: "Dex throws whatever beats the throw you've used most this match.",
    strategy: { behaviours: [{ type: "counterFavourite", w: 0.75 }], noise: 0.3, powers: "sometimes" },
  },
  {
    id: "luna", group: "classmates", name: "Luna", title: "Astronomy club", trait: "Mysterious", emoji: "🔮", stars: 3,
    intro: "The stars haven't decided yet. Neither have I.",
    lines: { beaten: "The stars favoured you today.", won: "The stars favoured me. Or did they?" },
    hint: "Luna is truly random. There's no pattern to find, so just play your best.",
    strategy: { behaviours: [{ type: "random" }], noise: 1, powers: "sometimes" },
  },
  // ---------- club captains ----------
  {
    id: "granite", group: "captains", name: "Granite", title: "Captain, Stone Club", trait: "Stubborn", emoji: "🪨", stars: 2,
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
    id: "fold", group: "captains", name: "Fold", title: "Captain, Origami Club", trait: "Patient", emoji: "📄", stars: 3,
    intro: "Patience folds every crane. Shall we?",
    lines: { beaten: "A fine fold. I bow to you.", won: "Patience wins again." },
    hint: "Fold never throws the same thing twice in a row, and prefers paper.",
    strategy: { bias: { rock: 0.28, paper: 0.44, scissors: 0.28 }, masks: ["noRepeat"], noise: 0.15, powers: "sometimes" },
    tell: { before: "paper", text: "*bows deeply*", chance: 0.6, falseChance: 0.15 },
  },
  {
    id: "snip", group: "captains", name: "Snip", title: "Captain, Fencing Club", trait: "Hot-headed", emoji: "🤺", stars: 3,
    intro: "En garde! I don't lose twice to the same move.",
    lines: { beaten: "Touché! I'll remember that one.", won: "En garde next time!" },
    hint: "After losing, Snip throws whatever beats your last throw.",
    strategy: {
      bias: { rock: 0.3, paper: 0.3, scissors: 0.4 },
      behaviours: [{ type: "winStay", w: 0.5 }, { type: "counterLast", when: "afterLoss", w: 0.85 }], noise: 0.2, powers: "sometimes",
    },
  },
  {
    id: "echo", group: "captains", name: "Echo", title: "Captain, Drama Club", trait: "Copycat", emoji: "🎭", stars: 4,
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
    intro: "I've read every duel you've had today. Begin.",
    lines: { beaten: "Interesting. I didn't read that.", won: "As expected." },
    hint: "Ren learns what you throw after your last two throws. Break your own patterns.",
    strategy: { behaviours: [{ type: "markov", order: 2, w: 0.75 }], noise: 0.2, powers: "whenBehind" },
  },
  // ---------- rival ----------
  {
    id: "rio", group: "more", name: "Rio", title: "Your rival", trait: "Adaptive", emoji: "🔥", stars: 4,
    intro: "I remember every duel we've had. Every single one.",
    lines: { beaten: "That one doesn't count. Again!", won: "I told you I'd remember." },
    hint: "Rio studies your throws from past matches too, not just this one.",
    strategy: { useMemory: true, behaviours: [{ type: "counterFavourite", w: 0.4 }, { type: "markov", order: 1, w: 0.6 }], noise: 0.25, powers: "whenBehind" },
  },
];

export const GROUPS = [
  { id: "classmates", label: "Classmates & staff" },
  { id: "captains", label: "Club captains" },
  { id: "more", label: "Your rival · practice bot" },
];

export const byId = (id) => ROSTER.find((n) => n.id === id) || ROSTER[0];
