# Hand Duel — webcam Rock-Paper-Scissors, fighting-game style

Hold your hand up to the camera and throw on **“Shoot!”**. Each win knocks health off your
opponent; win streaks hit harder; empty the bar for a **K.O.** First to win 2 rounds takes the match.

Modes:
- **VS CPU**: solo, against a cast of 12 opponents who each have a habit (Pip always opens with rock, Ms. Ruth
  cycles rock → paper → scissors, Ren learns your patterns…). Spot the habit to win. **Easy** shows a hint panel.
- **2 Players**: same device, one camera. P1 stands on the left half and P2 on the right, each raising one hand.
- **Online**: play a friend on another device with a 4-letter room code or invite link, and see each other's camera.

## Run it

```bash
python3 serve.py        # or: npm start
```

Open <http://localhost:8000>. `serve.py` is a plain static server that turns off browser caching, so your edits show up on a normal reload.
Browsers only allow the camera on **HTTPS or localhost**.

### Same wifi (phone, tablet, another laptop)
`serve.py` also serves HTTPS on port **8443** at your computer's wifi address and prints it, e.g.
`https://192.168.1.20:8443`. Browsers only give the camera to HTTPS pages, so open that on the other device.
It uses a self-signed certificate (made with openssl, kept in `.cert/`), so each device shows a
one-time warning: **Advanced → Proceed** (Chrome) or **Show Details → visit this website** (Safari).

1. On the computer, open <http://localhost:8000>, choose **Online → Create room**.
2. On the other device, open the printed `https://…:8443` address (also shown under the room code), choose **Online**, and enter the code.

Both devices need internet for the first handshake (the free PeerJS server matches the room code);
after that, video and moves go directly between them over the wifi.
If it can't connect, the router may isolate devices (common on guest/hotel wifi): use a hosted copy instead.

### Over the internet (friends anywhere)
The game is plain static files, so any free static host works. It gives you a real HTTPS address, so no warnings:

- **GitHub Pages**: push this folder to a GitHub repo, then Settings → Pages → Deploy from branch `main` / root.
  Your game is at `https://<user>.github.io/<repo>/`.
- **Netlify Drop**: drag the folder onto <https://app.netlify.com/drop>.
- **Quick test without hosting**: `cloudflared tunnel --url http://localhost:8000` (`brew install cloudflared`) gives a temporary public HTTPS link.

## Controls

| | Solo / Online | 2 Players (keyboard) |
|---|---|---|
| Throw | camera, or **R P S** / **1 2 3** / buttons | P1 **A S D**, P2 **J K L** |
| Power-ups | hand sign between throws, or **Q W E** / chips | P1 **Q W E**, P2 **U I O** |
| Next throw | **Space** / Enter | same |
| Your look (mask, stickers, background, filter) | 🎭 button | same |
| Pause auto-play | **Esc** | same |
| Mute | **M** | same |

Buttons and keys also override the camera during a countdown. **Auto-next** starts the next throw by itself, and pauses after 3 throws in a row with no hands seen.

**No mouse needed:** on the landing page, menus and panels, point with your palm to move the hand cursor and hold
still over a button to press it (0.8 s by default). In a match the cursor only appears while the game is idle, so
it never clashes with a throw.

## Screens and settings
- **Landing**: what the game is, the webcam ask, and a hand test (hand found, distance, light, try all three shapes).
  If the camera fails, a help screen explains the fix for that error and browser (blocked, no camera, busy, http, model download).
- **Menu**: VS CPU (opens the opponent picker, with Normal/Easy), 2 Players, Online, plus How to play, Test hand and Settings.
- **In a match**: *Side by side*, *Spotlight them* (default: opponent big, you in a small tile, like a video call) or
  *Spotlight me*. Drag the small tile to any edge or corner and it snaps there; ⤢ resizes it, ⇄ swaps. It moves itself
  out of the way when the opponent's hand would be behind it (online, each side sends a rough hand box for this).
  Hand tracking always reads the full camera, whatever the tile size.
- **On phones** (and portrait tablets) a match uses a focus layout: the big video fills the screen, the small video is a
  round badge next to a compact score card (the dot on it shows what your hand reads as; tap it to see it bigger), and
  the dock becomes a sheet you swipe up. Power-ups and Fight / Next throw stay in reach when the sheet is closed.
- **Settings** (⚙️, saved on this device): master volume, mute, sound effects, music; video quality (480p/720p/1080p),
  fullscreen, lite effects; mirror camera, hand skeleton, hand cursor on/off, smoothing, cursor speed, hold time;
  auto-next, difficulty (VS CPU) and arena.

## Fight rules (`js/fight.js`)
- 100 HP each. A won throw deals 25, the 2nd straight win deals 35, and the 3rd or more deals 45, so three in a row is a K.O.
- A draw is a *clash*: no damage, and both win streaks reset.
- 2-player and online: if one side shows nothing on “Shoot!”, they're *too slow* and take the hit. If neither side throws, the throw is replayed.
- **Fouls**: a hand that isn't a legal shape is called out by name: *1 finger*, *finger gun* (index + thumb),
  *3 fingers*, or *wrong scissors* (any two fingers other than index + middle, like horns). Paper needs all 4 fingers
  open (a pinky that's only half-open still counts). VS CPU replays a foul with a hint; in 2-player and online a foul
  loses to a legal throw, like being too slow.
- **Power-ups**: you hold at most one of each. Arm one *between* throws by holding its hand sign for 0.5 s
  (or tap its chip / press its key); it fires on your next throw and is spent whatever happens
  (a draw wastes it; a throw with no hands doesn't). Unheld ones are dimmed.
  - 👍 **Shield** (thumbs up): both fighters start every round with one. Lose the throw and take no damage.
    A thumbs up is still a fist, so thrown on “Shoot!” it counts as rock.
  - 👉 **Power** (finger gun): earned by winning 2 throws in a row. Win the throw for 2× damage.
  - 🤘 **Reverse** (horns, index + pinky): earned by losing 2 throws in a row. Lose the throw and the damage hits
    the winner instead. It can K.O. them.
  - Draws, blocks and reverses reset both players' runs. Everything resets at the start of a round.
  - Each CPU opponent has its own power-up habit (never, now and then, when behind, or always). Online, your armed power is hashed with your throw, so your rival can't see it coming.
- Best of 3 rounds. Rounds show *Perfect!* when the winner took no damage.

## How it works

| Piece | File | Notes |
|---|---|---|
| Hand tracking | `js/tracker.js` | MediaPipe Hand Landmarker 0.10.14 (21 3D points per hand, GPU with CPU fallback). Tracks 1 hand, or 2 in 2-player mode. |
| Gesture rules | `js/gesture.js` | Compares wrist→fingertip with wrist→middle-joint distance for each finger, so hand angle doesn't matter. Each finger is straight, half-open or curled; the thumb is only checked for the finger-gun foul. Illegal shapes come back as a `foul` code (`FOULS`); three of them also carry a `power` (the power-up sign). |
| Fair capture | `GestureBuffer` | Every frame is logged. It reads your hand for 0.7 s after “Shoot!” and takes the last gesture held steady (3+ frames), so the fist pumped during the countdown doesn't count. One dropped tracker frame doesn't break a hold. If a hand is in view but hasn't settled on a legal shape by then, it waits up to 0.5 s longer. |
| 2 players | `js/main.js` `loop` | Each hand belongs to whichever half of the screen it's on, so P1 can't throw for P2. |
| Online | `js/net.js` | WebRTC via PeerJS 1.5.4. The free PeerJS server only introduces the two browsers; video and moves go directly between them. Throws use **commit-reveal** (SHA-256, with a JS fallback on plain-http pages): each side sends a hash first, so nobody can wait and counter. The host's state is the source of truth after every throw. A heartbeat notices if the opponent drops. |
| Arenas | `js/arenas.js` | 4 arenas drawn in SVG with CSS particles (petals, rain, embers, sparkles). Choose one, or random per round. |
| Face masks | `js/masks.js`, `js/facemesh.js` | Painted masks (war paint, tiger, skull, robot, clown, ninja) drawn in code on MediaPipe's canonical face map and stretched over the 468-point face mesh with WebGL, so they bend as you talk, smile and turn. Eyes and mouth are cut out, and the camera's own light shades the mask. The mesh data is from MediaPipe's `canonical_face_model.obj` (Apache-2.0). |
| Your look | `js/effects.js` | Video-call style cosmetics: face masks (above), emoji glasses/hats/clown nose or full-face emoji avatars (MediaPipe Face Landmarker), background blur or painted backdrops (Selfie Segmenter), and colour filters. Drawn on a canvas over the camera, so hand tracking still reads the raw video. Online, the styled canvas is what your opponent sees. Models load only when a look needs them, and the choice is remembered on this device. |
| Sound | `js/audio.js` | Web Audio synth, no sound files: effects plus a chiptune loop (menu and fight tracks), each on its own bus under a master volume. Music ducks during the countdown. |
| Hand cursor | `js/cursor.js` | Palm centre, One Euro filtered (steady when still, little lag when moving), gain around the screen centre, magnetic hit areas with a sticky edge, dwell-to-press. |
| Settings | `js/settings.js` | Defaults, validation and localStorage (`handduel-settings`). |
| CPU opponents | `js/npc/strategy.js`, `js/npc/roster.js`, `js/duel/opponents.js` | Each opponent's personality is a spec of small behaviours (bias, opener, win-stay, lose-shift, cycle, copy, counter-last, counter-favourite, Markov, random) mixed by weight with noise, plus moods (e.g. when ahead or low on health), tells and a power-up policy. The opponent plans its throw before the countdown, from earlier throws only. Rio also remembers your throws from past matches (`handduel-npc-memory`). The match flow in `main.js` talks to opponents only through `js/duel/opponents.js`. |

Tests: `npm test` (gesture classifier, fight rules, SHA-256, UI markup, NPC strategies and opponents).

## Online limits
- PeerJS's free server is a shared community service and occasionally goes down. If it does, rooms can't be created until it's back. You can run your own (`npx peer --port 9000`) and point `js/net.js` at it.
- About 1 in 10 network pairs (strict corporate or campus wifi, some mobile carriers) can't connect directly and need a TURN relay. Add one to the `Peer` options in `js/net.js` if that's a problem.

## Device and browser notes
- Chrome, Edge and Firefox (desktop and Android), and Safari 15.4+ (macOS and iOS).
- First load downloads about 8 MB (tracker WASM and model), cached after that. Looks add a few MB more the first
  time you pick a face or background effect.
- Looks cost extra processing; on a slow phone turn them off if throws start reading late.
  Safari before version 18 can't filter canvas pixels, so there the colour filter shows only on your screen.
- The front camera is mirrored. The ⟲ button switches to the rear camera on phones.
- For 2 players, a laptop webcam at arm's length or more works best. Both hands must fit in the frame.
