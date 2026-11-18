# Hand Duel World: design plan for the RPG phase

*Draft v3, 18 Nov 2026. Status: plan only, nothing built yet. Working names are placeholders.*

Decisions so far (your answers, 18 Nov 2026):

| Topic | Decision |
|---|---|
| Format | **Single-player adventure first**, top-down like classic handheld RPGs; online multiplayer slots in later (section 10) |
| Setting | **A school.** Hand Duels are how students settle things |
| Masters | **Five club captains**, all five in the first version |
| Reward for beating a captain | **Stamps** (on a club stamp card) |
| Hint panel | **Only on Easy** (off by default) |
| Character proportions | **Chibi** (big head, small body) |
| Story | **A full storyline** with a rival, chapters and cutscenes (section 3) |
| Art | Placeholder now; your design examples become a new art pack later. The avatar duel screen is redesigned from your examples |

## 1. The idea in one paragraph

You transfer to **Knuckle Academy** (placeholder name), a school where every argument, from the last lunch roll to
the music-room booking, is settled with a Hand Duel. Five clubs run the school's duelling scene, each led by a
captain with a signature style. Classmates in the corridors spot you ("!") and challenge you; every one plays
differently, and what they say gives away their habits. Win club stamps, uncover what the Student Council is
planning, keep up with your rival, and save Hand Duels at the school festival. Every duel is played with your real
hand on the webcam, while the battle screen shows your custom chibi avatar.

The world, characters, names and story are **our own**. The classic handheld RPG is a format (a top-down map,
"someone spots you", a series of leaders to beat, a battle screen with HP bars), not a source: nothing copied from
any existing game.

## 2. The game loop

```
explore school ──▶ classmate spots you "!" ──▶ dialogue (hints at their habit) ──▶ duel (your hand vs their trait AI)
      ▲                                                                                     │
      └── story beat / new area / cosmetic unlocked ◀── coins, XP, stamp ◀── win ◀──────────┘
                                                                            lose → retry, with a tip
```

- **Session length:** one duel is about 1 minute, a corridor of classmates about 5 minutes, and a club (two members,
  then the captain) about 10 minutes. Good for short play on a phone.
- **Losing is fine:** there's no game over. You're back at the club door with a tip.
- **Difficulty:** Easy turns on the hint panel and makes opponents a little more predictable; Normal has no hints.
  It can be changed any time in settings.
- **Save:** in the browser (localStorage), with no account. An export/import code moves a save between devices;
  accounts come with online play.

## 3. The story

A full storyline in **chapters**, told through dialogue and short in-engine cutscenes (characters walk, the camera
pans, speech boxes appear), not animated films. A first draft, for you to change:

**Characters**
- **You:** a transfer student who has never duelled seriously. Name and look come from the avatar creator.
- **Rio, your rival:** transfers in on the same day and is sure they'll be the best duellist in school. Rio
  challenges you after every stamp, and **learns from your past duels** (Rio's AI uses your real throw history), so the
  rival gets harder in a way that's personal to you.
- **Ren, Student Council President:** calm, unbeatable, and planning to replace Hand Duels with "fair" lotteries.
- **The five club captains** (section 4.2) and the classmates (section 4.3).
- **Mx. Hale, the caretaker:** a former champion who gives tips, guides the tutorial and knows the school's secrets.

**Chapters**

| # | Chapter | What happens | Ends with |
|---|---|---|---|
| 0 | First day | Tutorial: Mx. Hale shows you how to duel (hand test, rock-paper-scissors, shield). You meet Rio at the gate | First duel against Rio (scripted easy) |
| 1 | Stone Club | Granite's club controls the gym. Classmates in the corridors; the stamp card system explained | Stone stamp; Rio's rematch |
| 2 | Paper Club | Fold's club in the library. Rumour: the Council wants to ban duels | Paper stamp; you find a Council memo |
| 3 | Fencing Club | Snip's club, angry about the ban. The school splits into sides | Blade stamp; Rio joins the Council's side |
| 4 | Drama Club | Echo's club stages a play about the "Silent Hand", a legendary duellist. Hale's past is revealed | Mirror stamp; final duel with Rio, who changes sides back |
| 5 | The Festival | With all five stamps you can challenge the Council at the school festival. Two phases against Ren | Credits; Ren agrees duels stay |
| + | After the story | Rematches with everyone at higher levels, hidden classmates, extra cosmetics. Later: the festival becomes the online lobby | |

**How the story is built**
- **Event scripts as data** (`data/story/*.json`): lists of steps like *walk Rio to (12, 4)*, *say*, *choose*,
  *start duel*, *set flag*, *fade*. Cutscenes are written without touching engine code.
- **Flags** (`metChapter2Memo`, `beatSnip`…) decide which NPCs appear, what they say, and which doors open.
- **Skippable** cutscenes and a "Story so far" recap in the menu, for short play sessions.
- **Writing:** short lines, a light tone, about one screen per beat. The draft text comes from me; you have the final
  say on names and story beats.

## 4. Characters with traits

### 4.1 Traits drive the AI, not just the dialogue
Each NPC is a data entry: look, dialogue, rewards, and a **strategy** built from small reusable behaviours. These
are based on patterns real people show in RPS: many beginners open with rock, winners tend to repeat their throw and
losers tend to switch to the next one ("win-stay, lose-shift", shown in a large 2014 study by Wang, Xu and Zhou),
and people avoid throwing the same thing three times.

| Behaviour | What it does | Typical trait |
|---|---|---|
| `bias` | Weights for ✊ ✋ ✌️ | Stubborn (rock), Gentle (paper), Sharp (scissors) |
| `opener` | Fixed first throw | Eager first-years |
| `winStay` / `loseShift` | Repeat after a win; switch after a loss | Most "human-like" classmates |
| `noRepeat` | Never the same throw twice in a row | Patient, careful |
| `cycle` | ✊ → ✋ → ✌️ → … | Rhythmic, musical |
| `copy` | Throws your last throw | Copycat |
| `counterLast` | Throws what beats your last throw | Hot-headed, competitive |
| `counterFavourite` | Throws what beats your most-used throw | Show-off, analytical |
| `markov` | Learns what you throw after each of your last 1–2 throws | Ren, the rival Rio |
| `random` | No pattern | Mysterious (teaches that some people can't be read) |
| `powers` | When to arm shield/power/reverse: always, when behind, never | Aggressive vs cautious |

- Behaviours are **mixed by weight with a `noise` value**, so NPCs can be read but never fully predicted. Difficulty
  is mostly `noise` and how many behaviours are stacked; Easy adds a bit of noise *towards* the NPC's habit.
- **Mood:** some NPCs switch behaviour mid-match: when their HP is below half (Echo starts countering), after two
  losses in a row (Bea panics into paper), or when they're ahead (Granite gets even more stubborn).
- **Tells:** each trait has a visible tell in the battle sprite (Granite cracks his knuckles before rock) and in the
  dialogue ("Rock is the strongest!"). On Easy, the hint panel points tells out; on Normal you have to notice them.

Example entry (format only; the values will be tuned in testing):

```json
{
  "id": "granite", "name": "Granite", "title": "Captain, Stone Club", "trait": "Stubborn",
  "avatar": { "skin": 2, "hair": "none", "top": "gi", "topColor": "#8a8fa8", "bottom": "hakama", "hat": "band" },
  "strategy": { "bias": { "rock": 0.5, "paper": 0.25, "scissors": 0.25 }, "winStay": 0.8, "noise": 0.25,
                "powers": "whenBehind",
                "mood": [{ "when": "ahead", "bias": { "rock": 0.7 } }] },
  "tell": { "before": "rock", "anim": "knuckles", "chance": 0.7 },
  "twist": "shieldEveryRound",
  "lines": { "intro": "Stone does not move. Neither do I.", "win": "Solid.", "lose": "...A crack. Well done." },
  "reward": { "stamp": "stone", "coins": 100, "unlock": ["headband-granite"] }
}
```

### 4.2 The five club captains

| Captain | Club (where) | Trait | How they play | Tell | Club twist | Stamp |
|---|---|---|---|---|---|---|
| **Granite** | Stone Club (gym) | Stubborn | Leans on rock; repeats after a win | Cracks his knuckles before rock | Starts every round with a shield | Stone |
| **Fold** | Origami Club (library) | Patient | Never repeats a throw; prefers paper | Bows deeper before paper | Can use reverse from round 1 | Paper |
| **Snip** | Fencing Club (sports hall) | Hot-headed | After a loss, throws what beats your last throw | Shouts louder before switching | Speed rounds: a faster countdown | Blade |
| **Echo** | Drama Club (stage) | Copycat | Copies your last throw; at half HP, counters the copy | Mirrors your idle pose | Both of you see your last throw on the floor | Mirror |
| **Ren** | Student Council (council room, then the festival stage) | Reader | Learns your habits (Markov on your last 2 throws) | None; a "reading you" meter fills | Best of 5, two phases | Final |

Each club has 2 members who play a weaker version of their captain's style, to practise reading it first.

### 4.3 Classmates and staff (first set)

| NPC | Who | Trait | Plays | Tell |
|---|---|---|---|---|
| **Pip** | First-year | Eager | Always opens with rock, then random | "Rock is the strongest!" |
| **Ms. Ruth** | Music teacher | Rhythmic | Cycles rock → paper → scissors | Hums a three-note tune |
| **Dex** | Games club regular | Show-off | Counters your most-used throw | "I've got your number." |
| **Bea** | Runs the bake sale | Nervous | Win-stay; panics into paper after a loss | "Oh no, oh no…" |
| **Coach Tank** | PE teacher | Loud | Arms every power the moment he has it | "FULL POWER!" |
| **Luna** | Astronomy club | Mysterious | Pure random | "Even I don't know." |
| **Rio** | Your rival | Adaptive | Learns from *your* saved throw history | Gets smug when it's worked you out |

Adding a character is one JSON entry plus placing them on the map in Tiled, so you can design characters yourself.

## 5. The school map

| Area | What's there | Opens |
|---|---|---|
| Front gate and courtyard | Start, Mx. Hale, the notice board (your record), a vending machine | Chapter 0 |
| Main corridor and classrooms | Classmates, your locker (avatar and cosmetics), the school shop | Chapter 0 |
| Gym | Stone Club | Chapter 1 |
| Library | Origami Club | Chapter 2 |
| Sports hall | Fencing Club | Chapter 3 |
| Auditorium | Drama Club | Chapter 4 |
| Council room → festival stage | Student Council | Chapter 5 |
| Rooftop, garden, music room | Side characters, secrets, hidden classmates | During the story |

- **Move:** arrow keys/WASD, tap to walk, or a joystick on phones. The hand isn't used for walking; the hand cursor
  still works for menus and dialogue.
- **Line of sight:** a challenger looks along a line of tiles. Step into it and they notice you ("!"), walk up and talk.
  You can say *Later*, and they wait there.
- **Camera:** off while walking, on only for duels (the tracker preloads in the background). Players without a
  camera can use the on-screen ✊ ✋ ✌️ buttons.

## 6. Art built for customisation and later redesign

### 6.1 Avatars are data
An avatar is a small object, the same shape for you, every NPC and (later) online players:

```json
{ "v": 1, "body": "base", "skin": 3, "hair": "spiky", "hairColor": "#2a2236",
  "top": "hoodie", "topColor": "#3fe0ff", "bottom": "shorts", "bottomColor": "#3b3f6b",
  "shoes": "sneakers", "hat": "none", "extra": "scarf" }
```

- **Layers (slots):** back (cape) → body (skin tone) → bottom → top → face extra → hair → hat. Draw order can change
  with facing direction (hair goes behind the head when walking up).
- **Recolourable:** items are drawn in grey "ramps" tinted at load time, so one hoodie drawing gives every colour.
- **Baked once:** an avatar's layers are combined into one sprite sheet on load and cached, so many characters stay
  cheap on phones.
- **Unlocks:** items have a `lock` field (coins, a stamp, beating someone, a story chapter), shown with 🔒 in the creator.
- **School uniform option:** a uniform top and bottom that every student can recolour, plus club jackets earned with
  each stamp.

### 6.2 Art packs: swap the whole look later
All art lives in one folder per pack, with a manifest:

```
art/packs/placeholder/
  pack.json      tile size, sprite sizes, frame layout per animation, slot list, palette ramps
  tiles/         school tilesets (from Tiled)
  avatar/        one sheet per item: town (walk 4 directions × 3 frames), battle poses, portrait
  ui/            dialogue frames, bubbles, icons
```

- The game reads sizes and frame layouts from `pack.json` (nothing hard-coded), so a pack can change tile size,
  frame counts, or proportions within the chibi style.
- Saves store **item ids**, not pictures: a new pack redraws everyone's avatar in the new style; missing items fall
  back to the nearest one.
- **Three renditions per item:** walking sprite, battle sprite (idle, wind-up, ✊ ✋ ✌️, hit, K.O., power auras) and
  portrait. A pack can start with only walking sprites and scale them for battle, as the placeholder does.
- **Chibi** (big head, small body) is the target for all packs: readable on small phone screens and expressive in
  portraits. Your design examples become a new pack; the placeholder stays as a fallback.

### 6.3 Sources
1. Original art (yours, commissioned, or drawn for this project).
2. CC0 / permissive pixel packs as placeholders, listed in `CREDITS.md`.
3. Never ripped or traced sprites. AI tools only for concept sketches.

**Tools:** Tiled for maps (JSON export), Aseprite or LibreSprite for sprites.

## 7. Screens

| Screen | Notes |
|---|---|
| Landing | Existing UI v2, with **Story** as the main button; Quick duel / VS CPU / Online stay |
| Avatar creator | Live preview in all three renditions; slots with item tiles and colour swatches; locked items say what unlocks them |
| School map | Top-down; HUD with stamps, coins and the current goal ("Find the Stone Club in the gym") |
| Dialogue / cutscene | Boxed dialogue with portrait, name and trait chip; choices; tap, keys or hand cursor; skip button |
| Battle | Avatars on a club backdrop, HP, round, power chips, hint panel on Easy, your camera small; redesigned from your examples |
| Results | Coins, XP, stamp ceremony for captains, unlock popups |
| Stamp card / menu | Stamps, story so far, characters met and your record against each |

## 8. Technical architecture (single-player)

Still a static site on GitHub Pages: no server, no cost.

| Module | Job |
|---|---|
| `js/duel/controller.js` | The match flow now in `main.js`, extracted, so camera view, avatar view and NPC opponents share it |
| `js/duel/opponents.js` | Opponent interface: `cpu` (today), `npc(strategy)` (new), `online` (today's net.js, later presence) |
| `js/npc/strategy.js` | The behaviours from 4.1, mixed by weight. Pure functions, unit-tested like `gesture.js` |
| `js/world/map.js`, `render.js`, `input.js` | Tiled map loader, Canvas 2D pixel renderer with cached layers, keyboard/tap/joystick |
| `js/world/actors.js` | Player and NPCs: grid movement, facing, line of sight, walking up to you, bubbles |
| `js/world/dialogue.js`, `script.js` | Dialogue boxes and choices; the story event-script runner with flags |
| `js/art/pack.js`, `avatar.js` | Load a pack, tint ramps, bake avatar sheets, fallbacks |
| `js/save.js` | Progress, flags, coins, unlocks, avatar, Rio's memory of your throws; versioned, export/import code |
| `data/npcs.json`, `data/items.json`, `data/story/*.json`, `maps/*.json` | Content, editable without touching code |

- **Renderer:** plain Canvas 2D (`image-rendering: pixelated`, integer scaling). Phaser only if needed later.
- **Hand tracking stays smooth:** one animation loop; the tracker is off on the map and on only in duels; map
  rendering pauses behind the battle screen.
- **NPC fairness:** an NPC picks its throw **before** reading yours (as the CPU does now), using only earlier throws.
  Tells and hints come from that pre-chosen plan, so they're honest.

## 9. Milestones (single-player first)

| # | Milestone | What you can try at the end |
|---|---|---|
| M0 | Refactor: duel controller and opponent interface out of `main.js` | The current game works exactly as before |
| M1 | NPC strategies + tests; VS CPU gets a "pick an opponent" list, with Easy hints | Play Pip, Bea, Granite… in the existing camera game |
| M2 | Map engine: the school's first areas, movement, collisions, line of sight, dialogue, save | Walk the school; classmates spot you and start duels |
| M3 | Layered avatars + placeholder pack + avatar creator | Make your character; see it on the map and in duels |
| M4 | Story engine (event scripts, flags, cutscenes) + Chapters 0–1 | Play the first day and the Stone Club |
| M5 | Battle screen v1 from your design examples, tells, hint panel, results | Proper avatar duels with personality |
| M6 | Chapters 2–5: the other four clubs, Rio's arc, the festival finale | The full story |
| M7 | Art pass with your designs as a new pack; colours and fonts | The look you want |
| M8+ | Online (section 10) | Meet friends at school |

M1 improves the current game straight away and tests the trait AI before the map exists.

## 10. Later: online in the same world

Kept from v1, built on top of the single-player world:
- **Presence:** see other players around the school, wave, emote, challenge them. The festival from Chapter 5 can
  become the online lobby. Recommended host: Cloudflare Durable Objects (PartyServer), about $5/month for a
  hobby-sized world; Colyseus or Supabase Realtime as alternatives.
- **Movement sync:** grid steps only, checked by the server, batched every 100 ms, only for nearby players.
- **Duels:** the server hands both players a one-time code; the duel runs peer-to-peer with today's `net.js`
  (commit-reveal), in camera or avatar mode. A result counts only when both reports agree.
- **Why it slots in:** online players are another opponent type (`online`), and their avatar is the same small JSON.
- **Safety:** camera duels only with consent (avatar mode by default with strangers), no free-text chat at launch,
  block/mute/report, rate limits, a 13+ age gate for camera duels. A school setting may attract younger players,
  so this needs a decision before online launches.

## 11. Still open
1. The school's name and your rival's name (Knuckle Academy and Rio are placeholders).
2. Story draft (section 3): keep, change, or replace any beats?
3. Your design examples for the battle screen and the art pack (chibi).

## Sources (checked Nov 2026)
- Wang, Xu & Zhou (2014), *Social cycling and conditional responses in the Rock-Paper-Scissors game*,
  Scientific Reports 4, 5830: <https://www.nature.com/articles/srep05830>
- Cloudflare Durable Objects pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing>
- Cloudflare acquires PartyKit: <https://blog.cloudflare.com/cloudflare-acquires-partykit>
- Colyseus pricing: <https://colyseus.io/pricing>
- Supabase Realtime limits: <https://supabase.com/docs/guides/realtime/limits>
