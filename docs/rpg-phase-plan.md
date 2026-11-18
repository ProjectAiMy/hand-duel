# Hand Duel World: design plan for the RPG phase

*Draft v2, 18 Nov 2026. Status: plan only, nothing built yet. Working name: "Hand Duel World" (placeholder).*

What changed in v2 (your feedback on the town mockups):
- **Single-player adventure first.** The town is a top-down adventure, like classic handheld monster-catching RPGs:
  you explore, NPCs notice you and challenge you, and you work through a series of dojos. Online multiplayer is
  moved to a later phase and slots into the same world (section 9).
- **Dojo masters and townsfolk, each with a personality** that changes *how they play* Rock-Paper-Scissors, not
  just what they say (section 4).
- **Art built for change.** Avatars are layered "paper-doll" sprites described by data, and all the art lives in a
  swappable art pack. Your later design examples can replace the look without touching game code or anyone's save
  (section 5).
- The avatar duel screen stays a placeholder until you send design examples.

## 1. The idea in one paragraph

You arrive in a small pixel town that is crazy about Hand Duels. Five dojos stand around the town, each run by a
master with a signature style. Townsfolk on the streets spot you ("!") and challenge you; every one of them plays
differently, and the dialogue gives away hints about their habits. Beat townsfolk for coins and XP, beat masters for
belts, unlock new areas and cosmetics, and finally face the Grandmaster. Every duel is played with your real hand
on the webcam, while the battle screen shows your custom pixel avatar.

The world, characters, names and story are **our own**. The classic handheld RPG is a format (top-down town,
"trainer spots you", gym-style progression, a battle screen with HP bars), not a source: no creatures, names, tiles,
music, menus or maps from any existing game.

## 2. The game loop

```
explore town ──▶ NPC spots you "!" ──▶ dialogue (hints at their habit) ──▶ duel (your hand vs their trait AI)
     ▲                                                                              │
     └── new area / cosmetic / power unlocked ◀── coins, XP, belt ◀── win ◀─────────┘
                                                                     lose → retry, with a hint
```

- **Session length:** one duel is about 1 minute; a townsfolk route about 5 minutes; a dojo (2–3 students, then the
  master) about 10 minutes. Good for short play on a phone.
- **Losing is fine:** no game over. You go back to the dojo door with a tip ("Granite threw rock 4 times out of 6").
- **Save:** in the browser (localStorage) at first. No account needed. An export/import code to move a save between
  devices; accounts come with online play.

## 3. The town

### 3.1 Layout (first version: one town, five dojos)

| Area | What's there | Unlocked by |
|---|---|---|
| Town square | Your home, the shop (cosmetics for coins), the notice board (your record), a fountain | Start |
| Stone Dojo | Master Granite and two students | Start |
| Paper Dojo | Sensei Fold | Stone Belt |
| Blade Dojo | Master Snip | Paper Belt |
| Mirror Dojo | Echo | Blade Belt |
| Summit Dojo (up the hill) | Grandmaster Ren | All four belts |
| Streets between them | 2–3 townsfolk per street, a few who only appear at night, or after a belt | Walking past |

Later areas (a beach, a market, a night festival) are just new maps plus NPC data; the engine doesn't change.

### 3.2 Exploring
- **Move:** arrow keys/WASD, tap to walk (pathfinding), or an on-screen joystick on phones. The hand isn't used to
  walk; the hand cursor still works for menus and dialogue.
- **Line of sight:** a challenger looks along a line of tiles. Step into it and they see you: "!" bubble, they walk
  up to you, the dialogue opens. You can't sneak past a challenger who has seen you, but you can say *Later*, and they
  wait there.
- **Talk:** walk up and press E or tap. Townsfolk who aren't challengers give tips, lore, or hints about a master.
- **Camera:** off while you walk. It only turns on for a duel (the tracker preloads in the background so the duel
  opens fast). Players without a camera can duel with on-screen ✊ ✋ ✌️ buttons (the existing manual mode).

### 3.3 Duels against NPCs
- The same rules as now (`js/fight.js`): HP, rounds, shield/power/reverse, fouls, the capture timing you tuned.
- The battle screen shows **your avatar vs theirs**, with your own camera small in a corner (only you see it).
- **Dojo twists:** each dojo changes one rule, so every master feels different (see section 4.3).
- **Hints (on by default, can be turned off):** after a few throws a small "Read" panel shows the NPC's recent throws
  and a one-line hint. This teaches players to look for patterns, which is the actual skill in RPS.

## 4. NPCs with character traits

### 4.1 Traits drive the AI, not just the dialogue
Each NPC is a data entry: look, dialogue, rewards, and a **strategy** built from small, reusable behaviours. These
come from patterns real people show when playing RPS: many beginners open with rock, winners tend to repeat their
throw and losers tend to switch to the next one ("win-stay, lose-shift", shown in a large 2014 study by Wang, Xu
and Zhou), and people avoid repeating a throw three times.

| Behaviour | What it does | Typical trait |
|---|---|---|
| `bias` | Weights for ✊ ✋ ✌️ | Stubborn (rock), Gentle (paper), Sharp (scissors) |
| `opener` | Fixed first throw | Eager kids |
| `winStay` / `loseShift` | Repeat after a win; switch after a loss | Most "human-like" townsfolk |
| `noRepeat` | Never the same throw twice in a row | Patient, careful |
| `cycle` | ✊ → ✋ → ✌️ → … | Rhythmic, musical |
| `copy` | Throws your last throw | Copycat |
| `counterLast` | Throws what beats your last throw | Hot-headed, competitive |
| `counterFavourite` | Throws what beats your most-used throw | Show-off, analytical |
| `markov` | Learns what you throw after each of your last 1–2 throws | Grandmaster |
| `random` | No pattern at all | Mysterious (teaches that some opponents can't be read) |
| `powers` | When to arm shield/power/reverse: always, when behind, never | Aggressive vs cautious |

- Behaviours are **mixed with weights plus a `noise` value**, so NPCs are readable but never a sure thing. Difficulty
  is mostly `noise` (lower = more predictable = easier) and how many behaviours are stacked.
- **Mood:** some NPCs switch behaviour mid-match: when their HP is below half (Echo starts countering), after two
  losses in a row (Bea panics into paper), or when they're ahead (Granite gets even more stubborn).
- **Tells:** each trait has a visible tell in the battle sprite (Granite cracks his knuckles before rock) and a line in
  the dialogue ("Rock is the strongest! I always start with rock!"). Players learn to read people, not just odds.

Example entry (format only; the values will be tuned in testing):

```json
{
  "id": "granite", "name": "Master Granite", "title": "Stone Dojo", "trait": "Stubborn",
  "avatar": { "body": "broad", "skin": 2, "hair": "none", "top": "gi", "topColor": "#8a8fa8", "bottom": "hakama", "extra": "headband" },
  "strategy": { "bias": { "rock": 0.5, "paper": 0.25, "scissors": 0.25 }, "winStay": 0.8, "noise": 0.25,
                "powers": "whenBehind",
                "mood": [{ "when": "ahead", "bias": { "rock": 0.7 } }] },
  "tell": { "before": "rock", "anim": "knuckles", "chance": 0.7 },
  "twist": "shieldEveryRound",
  "lines": { "intro": "Stone does not move. Neither do I.", "win": "Solid.", "lose": "...A crack. Well done." },
  "reward": { "belt": "stone", "coins": 100, "unlock": ["shield-skin-granite"] }
}
```

### 4.2 The five dojo masters

| Master | Trait | How they play | Tell | Dojo twist | Reward |
|---|---|---|---|---|---|
| **Master Granite**, Stone Dojo | Stubborn | Leans on rock; repeats after a win | Cracks his knuckles before rock | Starts every round with a shield | Stone Belt |
| **Sensei Fold**, Paper Dojo | Patient | Never repeats a throw; prefers paper | Bows deeper before paper | Can use reverse from round 1 | Paper Belt |
| **Master Snip**, Blade Dojo | Hot-headed | After a loss, throws what beats your last throw | Shouts louder before switching | Speed rounds: a faster countdown | Blade Belt |
| **Echo**, Mirror Dojo | Copycat | Copies your last throw; at half HP, counters the copy instead | Mirrors your idle pose | Both of you see your last throw on the floor | Mirror Belt |
| **Grandmaster Ren**, Summit Dojo | Reader | Learns your habits (Markov on your last 2 throws) | None. A "reading you" meter fills instead | Best of 5, two phases | Black Belt + title |

Each dojo also has 2 students who use a weaker version of the master's style, so you can practise reading it
before the master.

### 4.3 Townsfolk (first set)

| NPC | Trait | Plays | Dialogue tell |
|---|---|---|---|
| **Pip**, a kid | Eager | Always opens with rock, then random | "Rock is the strongest!" |
| **Nana Ruth**, retired champion | Rhythmic | Cycles rock → paper → scissors | Hums a three-note tune |
| **Dex**, gamer | Show-off | Counters your most-used throw | "I've got your number." |
| **Bea**, baker | Nervous | Win-stay; panics into paper after a loss | "Oh no, oh no…" |
| **Coach Tank** | Loud | Arms every power the moment he has it | "FULL POWER!" |
| **Luna** | Mysterious | Pure random | "Even I don't know." |

Adding an NPC is adding one JSON entry and placing them on the map in Tiled, so you can design characters yourself.

## 5. Art built for customisation and later redesign

### 5.1 Avatars are data
An avatar is a small object, the same for you, every NPC and (later) online players:

```json
{ "v": 1, "body": "base", "skin": 3, "hair": "spiky", "hairColor": "#2a2236",
  "top": "hoodie", "topColor": "#3fe0ff", "bottom": "shorts", "bottomColor": "#3b3f6b",
  "shoes": "sneakers", "hat": "none", "extra": "glasses" }
```

- **Layers (slots):** cape/back → body (skin tone) → bottom → top → face extra → hair → hat. Draw order can change
  per facing direction (hair goes behind the head when walking up).
- **Recolourable:** each item is drawn in a few grey "ramps" that are tinted at load time, so one hoodie drawing gives
  every colour. Colour pickers cost no extra art.
- **Baked once:** the game combines an avatar's layers into one sprite sheet when it loads and caches it, so drawing
  dozens of characters stays cheap on phones.
- **Unlocks:** items have a `lock` field (coins, a belt, beating a certain NPC), shown with a 🔒 in the creator.

### 5.2 Art packs: swap the whole look later
All art sits in one folder per pack, with a manifest:

```
art/packs/placeholder/
  pack.json      tile size, sprite sizes, frame layout per animation, slot list, palette ramps
  tiles/         town tilesets (from Tiled)
  avatar/        one sheet per slot item: town (walk 4 directions × 3 frames), battle poses, portrait
  ui/            dialogue frames, bubbles, icons
```

- The game reads sizes and frame layouts from `pack.json`, never hard-coded, so a new pack can use 16×16 or 32×32
  tiles, chibi or taller characters, more animation frames, or a portrait style.
- Saves store **item ids**, not pictures. When a new pack replaces the art, everyone's avatar is redrawn in the new
  style. Items missing from a new pack fall back to the nearest one.
- **Three renditions per item:** town sprite (small, walking), battle sprite (big, posed: idle, wind-up, ✊ ✋ ✌️,
  hit, K.O., power auras) and portrait (for dialogue). A pack can start with only the town sprite and scale it up for
  battle, as the placeholder does, then add proper battle art later.
- When you send design examples, they become a new pack. The placeholder pack stays as a fallback.

### 5.3 Sources
1. Original art (yours, commissioned, or drawn for this project).
2. CC0 / permissive pixel packs as placeholders, listed in `CREDITS.md`.
3. Never ripped or traced sprites. AI tools only for concept sketches.

**Tools:** Tiled for maps (JSON export), Aseprite or LibreSprite for sprites.

## 6. Screens

| Screen | Notes |
|---|---|
| Landing | Existing UI v2, with **Adventure** as the main button; Quick duel / VS CPU / Online stay as they are |
| Avatar creator | Live preview in all three renditions; slots with item tiles and colour swatches; locked items show what unlocks them |
| Town | Top-down, HUD with belts, coins and the current goal ("Next: Stone Dojo"); a menu for bag/avatar/map/settings |
| Dialogue | Classic boxed dialogue with a portrait, name, trait chip and choices (*Duel!* / *Later*); works with tap, keys and the hand cursor |
| Battle | Avatars on a dojo backdrop, HP, round, power chips, the Read panel, your camera small; layout to be redesigned with your examples |
| Results | Coins, XP, belt ceremony for masters, unlock popups |
| Map / notice board | Dojos beaten, NPCs met, records against each |

## 7. Technical architecture (single-player)

Still a static site on GitHub Pages: no server, no cost.

| Module | Job |
|---|---|
| `js/duel/controller.js` | The match flow now in `main.js`, extracted, so camera view, avatar view and NPC opponents share it |
| `js/duel/opponents.js` | Opponent interface: `cpu` (today), `npc(strategy)` (new), `online` (today's net.js, later presence) |
| `js/npc/strategy.js` | The behaviours from 4.1, mixed by weight. Pure functions, unit-tested like `gesture.js` |
| `js/world/map.js`, `render.js`, `input.js` | Tiled map loader, Canvas 2D pixel renderer with cached layers, keyboard/tap/joystick |
| `js/world/actors.js` | Player and NPCs: grid movement, facing, line of sight, walking up to you, bubbles |
| `js/world/dialogue.js` | Dialogue boxes and choices from NPC data |
| `js/art/pack.js`, `avatar.js` | Load a pack, tint ramps, bake avatar sheets, fallbacks |
| `js/save.js` | Progress, coins, unlocks, avatar; versioned with migrations; export/import code |
| `data/npcs.json`, `data/items.json`, `maps/*.json` | Content, editable without touching code |

- **Renderer:** plain Canvas 2D (`image-rendering: pixelated`, integer scaling). Phaser only if we need much more later.
- **Hand tracking stays smooth:** one animation loop; the tracker is off in town and on only in duels; world rendering
  pauses behind the battle screen.
- **NPC fairness:** the NPC picks its throw **before** reading yours (the same as the CPU now), using only the
  history of earlier throws. Tells and hints are generated from that pre-chosen plan, so they're honest.

## 8. Milestones (single-player first)

| # | Milestone | What you can try at the end |
|---|---|---|
| M0 | Refactor: duel controller and opponent interface out of `main.js` | The current game works exactly as before |
| M1 | NPC strategies + tests; VS CPU gets a "pick an opponent" list using them | Play Pip, Bea, Granite… in the existing camera game |
| M2 | Town engine: one map, movement, collisions, line of sight, dialogue, save | Walk the town; NPCs spot you and start duels |
| M3 | Layered avatars + placeholder pack + avatar creator | Make your character; see it in town and in duels |
| M4 | Battle screen v1 (to your design examples), tells, Read panel, results | Proper avatar duels with personality |
| M5 | Five dojos, students, twists, belts, shop and unlocks | The full first adventure |
| M6 | Art pass with your designs as a new pack | The look you want |
| M7+ | Online (section 9) | Meet friends in town |

M1 is a quick win that improves the current game straight away, and it tests the trait AI before any town exists.

## 9. Later: online in the same world

Kept from v1, now built on top of the single-player world:
- **Presence:** see other players walking in town, wave, emote, challenge them. Recommended host: Cloudflare Durable
  Objects (PartyServer), about $5/month for a hobby-sized world; Colyseus or Supabase Realtime as alternatives.
- **Movement sync:** grid steps only, checked by the server, batched every 100 ms, only for players within ~20 tiles.
- **Duels:** the server hands both players a one-time code; the duel runs peer-to-peer with today's `net.js`
  (commit-reveal), in camera or avatar mode. A result counts only when both reports agree.
- **Why it slots in:** online players are just another opponent type (`online`), and their avatar is the same small
  JSON as everyone else's, so sending your look costs a few hundred bytes.
- **Safety:** camera duels only with consent (avatar mode by default with strangers), no free-text chat at launch,
  block/mute/report, rate limits, a 13+ age gate for camera duels.

## 10. Open questions for you
1. **Setting and name:** a dojo town as described, or a different theme (school, island, space station)?
2. **Five dojos** in the first version, or start with fewer (say 3) and add more?
3. **Belts** as the reward for masters (as proposed), or something else (stamps, scrolls, trophies)?
4. **Hints (Read panel):** on by default for everyone, or only on an "easy" setting?
5. **Character proportions** for the art packs: small chibi (big head, like the placeholder), or taller characters?
   This matters most for your design examples.
6. **Story:** light (a few lines per NPC, as proposed), or a real storyline with a rival character?

## Sources (checked Nov 2026)
- Wang, Xu & Zhou (2014), *Social cycling and conditional responses in the Rock-Paper-Scissors game*,
  Scientific Reports 4, 5830: <https://www.nature.com/articles/srep05830>
- Cloudflare Durable Objects pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing>
- Cloudflare acquires PartyKit: <https://blog.cloudflare.com/cloudflare-acquires-partykit>
- Colyseus pricing: <https://colyseus.io/pricing>
- Supabase Realtime limits: <https://supabase.com/docs/guides/realtime/limits>
