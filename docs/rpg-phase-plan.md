# Hand Duel World: design plan for the RPG phase

*Draft, 18 Nov 2026. Status: plan only, nothing built yet. Working name: "Hand Duel World" (placeholder).*

## 1. The idea in one paragraph

A small online pixel-art world in the style of old handheld RPGs: a top-down town you walk around in, where you
see other players moving, wave at them, and **challenge anyone you meet to a Hand Duel**. A duel can be a
**camera duel** (today's game: you see each other's webcams) or an **avatar duel** (both players appear as pixel
fighters, animated by their real hand, which is tracked in the background; no video is sent). Think "Gather.town
meets a retro RPG battle screen", with your hand as the controller.

The look and the world are **our own**. The old-school RPG is a mood (pixel tiles, top-down map, a battle screen
with sprites and HP bars), not a source. No creatures, names, tiles, music, menus or maps copied from any existing
game.

## 2. Patterns borrowed from the inspirations

| Inspiration | Pattern to borrow | How it shows up here |
|---|---|---|
| Classic top-down handheld RPGs (as a genre) | Grid movement, readable 16×16/32×32 tiles, a dedicated battle screen with HP bars, "!" when someone notices you | Grid movement in town; a duel opens a battle screen; a "!" bubble appears when someone challenges you |
| Gather.town | Proximity is the interface: walk near someone to interact; private spaces | Walk next to a player to see "Challenge"; arenas are rooms you enter; video only inside a duel |
| Neal.fun | One idea, zero friction, instantly playable | No account to start: pick a name and a sprite, then you're in town in under 10 s |
| Poki / CrazyGames top titles | Fast first load, play before sign-up, big clear CTAs | World loads in about 1 MB; the hand tracker (8 MB) loads only when you enter your first duel |
| Google Experiments (Teachable Machine and others) | Explain the camera before asking, show what the model sees | The landing hand test we just built is reused before the first duel |
| visionOS / spatial UI | Large targets, hover feedback before commit, glass over live content | The hand cursor, hold-to-press and glass panels from UI v2 carry over to world menus |

## 3. Player experience

### 3.1 First visit
1. Landing (existing UI v2), with a new primary button: **Enter the world**. The existing modes stay under "Quick duel".
2. Pick a name and an avatar (6–8 original pixel characters, plus 2–3 colour swaps).
3. You appear in the town square. A short arrow-key / joystick tip, then you're free.

### 3.2 In the world
- **Move:** arrow keys or WASD; tap or click a tile to walk there; an on-screen joystick on phones.
  The hand is *not* used for walking (holding an arm up to walk is tiring). The hand cursor still works for menus.
- **See people:** other players walk around with name tags. Above 30 people on screen, distant players are drawn as
  simple dots or hidden.
- **Interact:** walk next to someone and press E, tap them, or hold the hand cursor on them. A small menu offers
  *Challenge*, *Wave 👋* and *Mute/Block*.
- **Challenge:** they see "‼ Sam challenges you!" with *Camera duel*, *Avatar duel* or *No thanks*, auto-declined after
  15 s. The challenger can preselect the mode.
- **Places:** a town square (spawn), **arenas** (step on a pad to queue for a random opponent), a **training dojo**
  (CPU opponents with fixed styles, e.g. one who favours rock), and a notice board with the leaderboard.
- **Emotes:** 4 quick emotes (👋 😂 😤 🤝), shown as pixel bubbles. No free-text chat at first (see Safety).

### 3.3 The duel
- Both players are pulled into a **battle screen** while their world sprites show a ⚔️ bubble to everyone else.
- **Camera duel:** today's online game, unchanged (spotlight layout, commit-reveal, power-ups).
- **Avatar duel:** a side-on pixel battle scene:
  - Each fighter has idle, wind-up (in time with "Rock, Paper, Scissors"), rock/paper/scissors throw, hit, block
    (shield), power (finger gun), reverse (horns) and K.O. animations.
  - Your own camera appears small, **only on your screen**, with the hand skeleton, so you can see the tracking working.
    Your opponent only ever sees your avatar.
  - Arena backdrops reuse the four existing arenas as pixel-art versions.
- After the match: *Rematch* or *Back to town*, plus a result card (W/L, perfect rounds) and a small reward (see 3.4).

### 3.4 Light progression (later milestone)
- Win count, streaks and a seasonal leaderboard on the notice board.
- Cosmetics earned by playing: avatar colours, hats, battle backdrops, victory poses. No pay-to-win.
- Training dojo "badges" for beating each CPU style: a reason to come back.

## 4. Technical architecture

### 4.1 What stays the same
- A static site on GitHub Pages: plain ES modules, no build step.
- `js/tracker.js`, `js/gesture.js` and `js/fight.js` (pure rules) are reused unchanged.
- `js/net.js` (PeerJS WebRTC + commit-reveal) is still the 1:1 duel channel, already verified by the user on real devices.

### 4.2 What's new

```
Browser                                              Cloud
┌───────────────────────────────┐   WebSocket   ┌──────────────────────────────┐
│ world/   map, movement, render│◀────────────▶│ World server (one room per    │
│ duel/    duel controller      │   presence,   │ map shard): positions,        │
│          (camera | avatar)    │   challenges  │ challenges, emotes, duel      │
│ tracker/ gesture/ fight/      │               │ codes, results                │
│ net.js   1:1 WebRTC duel ─────┼──────────────▶│ (signalling for the duel is   │
└───────────────────────────────┘   P2P video   │  PeerJS at first, ours later) │
                                    + moves     └──────────────────────────────┘
```

**World server: recommended Cloudflare Durable Objects, using the PartyKit / PartyServer library.**
- One Durable Object per map "shard" (for example 50 players). It holds positions in memory and broadcasts
  changes about 10 times a second. WebSockets are built in, and it runs close to players.
- Cost: Durable Objects have a free allowance, but Cloudflare's own pages disagree on whether the free plan
  includes them. Plan for the **$5/month Workers Paid plan**, which comfortably covers a hobby-sized world. Incoming
  WebSocket messages are billed at 20:1, which keeps 10 Hz movement cheap. Check the current pricing page before launch.
- Cloudflare bought PartyKit in 2024 and said there are no charges beyond normal Workers usage.

Alternatives considered:

| Option | Fit | Why not first |
|---|---|---|
| **Colyseus** (open source, room state sync) | Very good for game rooms; self-host free or Colyseus Cloud from $15/month | Needs a Node server to run and update; more than we need for positions + challenges |
| **Supabase Realtime** | Easy presence/broadcast; free plan has 200 concurrent connections and 100 messages/s | 100 msg/s is too tight for movement once ~20 players move at 10 Hz; better for accounts/leaderboards later |
| **PeerJS mesh only** (no server) | Free | A mesh doesn't scale past a handful of players, and there's no authority for challenges |
| Firebase Realtime DB | Fine presence | Per-download billing gets expensive for movement streams |

**Movement sync (simple and robust):**
- Grid-based movement: a client sends "move to tile (x, y)" only on each step, not every frame. The server checks the
  step is adjacent and walkable (no teleporting through walls) and rebroadcasts. Other clients tween the sprite
  over about 150 ms.
- Batches: the server sends one combined update per 100 ms tick per shard.
- Interest management: send each client only players within ~20 tiles.

**Duel handoff:**
1. A sends `challenge(B, mode)` → the server forwards it to B. B accepts.
2. The server makes a one-time duel code and tells both players. A hosts and B joins, using today's `net.js` flow with that code.
3. The duel runs peer-to-peer exactly as now: commit-reveal moves, plus video only in camera mode.
4. Both clients report the result to the server, which records a win only if the two reports agree.
5. Later: move signalling from the public PeerJS server onto our own server (the Durable Object can relay
   WebRTC offers/answers), and add a TURN relay for the ~10% of networks that can't connect directly.

### 4.3 Client modules (new)

| Module | Job |
|---|---|
| `js/world/map.js` | Load a map exported from **Tiled** (JSON): tile layers, collision layer, objects (arenas, doors, signs) |
| `js/world/render.js` | Canvas 2D, integer-scaled pixel art (`image-rendering: pixelated`). Static layers pre-drawn once to an offscreen canvas; only sprites redrawn each frame |
| `js/world/players.js` | Local and remote players, tweened grid movement, name tags, bubbles |
| `js/world/input.js` | Keyboard, tap-to-walk with A* pathfinding on the collision grid, phone joystick, hand-cursor interactions |
| `js/world/client.js` | WebSocket to the world server, reconnect with backoff, message schema/versioning |
| `js/duel/controller.js` | The match flow currently in `main.js`, extracted so it can run in either presentation |
| `js/duel/avatar-view.js` | Pixel battle screen: sprite sheets, timings tied to the countdown and the reveal |

**Renderer choice:** plain Canvas 2D first. A 20×15 tile view with a few dozen sprites is tiny work, and it keeps the
page light. Phaser (~1 MB) only if we later want physics, tile animation tooling or particle systems.

### 4.4 Keeping hand tracking smooth
- **One `requestAnimationFrame` loop owns the frame.** In the world, the hand tracker is **off** (camera off, no
  model running) unless the hand cursor is turned on, and then it uses Low quality (480p). Entering a duel switches
  the tracker to full mode and pauses world rendering (the world is hidden behind the battle screen).
- Pixel art is cheap to draw: cached background layers and no blur or filters on world canvases.
- Load the 8 MB tracker in the background during the walk to your first duel (`import()` after first input),
  so the battle screen opens instantly.

### 4.5 Avatar duel: hand → sprite
- `classify()` already returns `gesture`, `foul` and `power`. The avatar mirrors the live result:
  open hand → "ready" pose; a power sign held → glowing aura; at "Shoot!" → the throw pose for the read gesture.
- During the countdown the avatar does a wind-up bob in time with each beat, matching the existing `pump`.
- The opponent's avatar only reveals its throw after commit-reveal completes, exactly like the CPU hand now, so
  avatar mode is as cheat-proof as camera mode.
- **Bandwidth:** avatar mode sends no video, only a few small messages, so it works on weak mobile data.
- Optional later: a "live hands" option that streams your (smoothed) gesture state between throws so the other
  avatar visibly fidgets. This is cosmetic and never affects the result.

## 5. Art and audio
- **Style:** 16×16 tiles drawn at 3–4× scale, a limited palette (32 colours) for cohesion, and 32×32 battle sprites
  with 4–6 frames per action.
- **Tools:** Aseprite or the free LibreSprite for sprites, **Tiled** for maps (exports the JSON we load).
- **Sources, in order of preference:**
  1. Original art made for this project (commissioned or drawn).
  2. CC0 / permissively licensed pixel packs as placeholders. Check each pack's licence and keep a `CREDITS.md`.
  3. Never ripped or traced sprites from existing games.
- ComfyUI or similar only for **concept sketches**; final sprites drawn or cleaned by hand (AI pixel art is rarely
  grid-clean, and the provenance matters).
- **Audio:** extend the chiptune synth in `js/audio.js` with a town theme and a battle theme. Footstep and bump
  blips are free (synth, no files).

## 6. Safety, privacy and fair play
- **Camera only in duels, only with consent:** camera duels require both players to accept. Avatar mode is the
  default for random arena matches with strangers, and camera mode is opt-in.
- **No free-text chat at launch:** emotes only. This avoids most moderation work. Add preset phrases later.
- **Block / mute / report** on every player menu. Blocked players are invisible to you and can't challenge you.
- **Names:** length limits and a simple word filter; host-side rate limits on challenges (e.g. 1 per 10 s).
- **Fair play:** commit-reveal (existing). The server records a result only when both reports agree. Rank only from
  agreed results, and rate-limit rematches between the same pair so nobody can farm wins.
- **Age:** a general-audience game with webcam video to strangers needs a minimum-age gate for camera duels (13+),
  and parental guidance in the privacy note. To be confirmed with you before launch.

## 7. Prerequisites in the current code
1. **Split `js/main.js` (~1,700 lines)** into a duel controller, a presentation layer (camera view today) and app
   shell/screens. This is the main enabler, and it also makes the current game easier to maintain.
2. Give `net.js` a way to accept a duel code from outside (the world server) instead of only the lobby.
3. Move landing/menu screens to a small screen router so "World" and "Quick duel" are both entries.

## 8. Milestones

| # | Milestone | What you can try at the end | Rough effort |
|---|---|---|---|
| M0 | Refactor: duel controller extracted from `main.js` | The current game works exactly as before | 2–3 days |
| M1 | Offline world: one town map, movement, collisions, NPC challengers who start CPU duels | Walk around alone and fight CPU "trainers" | 3–5 days |
| M2 | Avatar duel vs CPU: battle screen, placeholder sprites driven by your hand | Fight the CPU as a pixel fighter | 4–6 days (+ art) |
| M3 | Multiplayer presence: world server, names, avatars, emotes, interest management | See friends walk around in the same town | 4–6 days |
| M4 | Challenges → online duels in camera or avatar mode, agreed results | Challenge a friend you meet in town | 3–4 days |
| M5 | Safety and robustness: block/report, rate limits, reconnects, own signalling + TURN | Ready for strangers | 3–5 days |
| M6 | Progression: stats, leaderboard board, cosmetics, dojo badges | Reasons to come back | 1–2 weeks |
| — | Final art pass, colours and fonts (your "last stage") | | depends on art |

M0–M2 need no server or money, so the look and feel can be judged before any hosting commitment.

## 9. Open questions for you
1. **Setting:** a town with a dojo/arena theme (matches the current arenas), or something else (a school, a
   space station, a fantasy village)?
2. **Avatars:** a fixed cast of characters, or a simple character creator (body, hair, outfit, colours)?
3. **Default duel mode with strangers:** avatar (safer, lighter) as proposed, or camera?
4. **Accounts:** guest-only at first (proposed), or sign-in from day one so wins and cosmetics persist?
5. **Art:** will you draw or commission sprites, or should M1–M2 use CC0 placeholder packs?
6. **Scale target:** a friends-and-classmates world (tens of players), or open to the public (hundreds)? This
   decides the hosting tier and how much moderation is needed.
7. **Audience age:** anyone under 13 expected? This affects camera duels and data rules.

## Sources (checked Nov 2026)
- Cloudflare Durable Objects pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing> and
  <https://www.cloudflare.com/developer-platform/products/durable-objects/>
- Cloudflare acquires PartyKit: <https://blog.cloudflare.com/cloudflare-acquires-partykit>
- Colyseus pricing: <https://colyseus.io/pricing>, <https://docs.colyseus.io/cloud/pricing-billing>
- Supabase Realtime limits: <https://supabase.com/docs/guides/realtime/limits>
