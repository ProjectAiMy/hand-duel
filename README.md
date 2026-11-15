# Hand Duel — webcam Rock-Paper-Scissors, fighting-game style

Hold your hand up to the camera and throw on **“Shoot!”**. Each win knocks health off your
opponent; win streaks hit harder; empty the bar for a **K.O.** First to win 2 rounds takes the match.

Modes:
- **VS CPU**: solo.
- **2 Players**: same device, one camera. P1 stands on the left half and P2 on the right, each raising one hand.
- **Online**: play a friend on another device with a 4-letter room code or invite link, and see each other's camera.

## Run it

```bash
python3 serve.py        # or: npm start
```

Open <http://localhost:8000>. `serve.py` is a plain static server that turns off browser caching, so your edits show up on a normal reload.
Browsers only allow the camera on **HTTPS or localhost**.

### On a phone, or online with a friend
Other devices can't reach your `localhost`, so they need an HTTPS URL:

- **Host it** (best for online play): push the folder to GitHub Pages, Netlify or Cloudflare Pages. There's no build step.
- **Tunnel for testing**: `npx localtunnel --port 8000` or `cloudflared tunnel --url http://localhost:8000`.

## Controls

| | Solo / Online | 2 Players (keyboard) |
|---|---|---|
| Throw | camera, or **R P S** / **1 2 3** / buttons | P1 **A S D**, P2 **J K L** |
| Next throw | **Space** / Enter | same |
| Pause auto-play | **Esc** | same |
| Mute | **M** | same |

Buttons and keys also override the camera during a countdown. **Auto-next** starts the next throw by itself, and pauses after 3 throws in a row with no hands seen.

## Fight rules (`js/fight.js`)
- 100 HP each. A won throw deals 25, the 2nd straight win deals 35, and the 3rd or more deals 45, so three in a row is a K.O.
- A draw is a *clash*: no damage, and both win streaks reset.
- 2-player and online: if one side shows nothing on “Shoot!”, they're *too slow* and take the hit. If neither side throws, the throw is replayed.
- Best of 3 rounds. Rounds show *Perfect!* when the winner took no damage.

## How it works

| Piece | File | Notes |
|---|---|---|
| Hand tracking | `js/tracker.js` | MediaPipe Hand Landmarker 0.10.14 (21 3D points per hand, GPU with CPU fallback). Tracks 1 hand, or 2 in 2-player mode. |
| Gesture rules | `js/gesture.js` | Compares wrist→fingertip with wrist→middle-joint distance for each finger, so hand angle doesn't matter. |
| Fair capture | `GestureBuffer` | Every frame is logged. On “Shoot!” it takes the last gesture held steady (3+ frames) from 100 ms before to 350 ms after, so the fist pumped during the countdown doesn't count. |
| 2 players | `js/main.js` `loop` | Each hand belongs to whichever half of the screen it's on, so P1 can't throw for P2. |
| Online | `js/net.js` | WebRTC via PeerJS 1.5.4. The free PeerJS server only introduces the two browsers; video and moves go directly between them. Throws use **commit-reveal**: each side sends a hash first, so nobody can wait and counter. The host's state is the source of truth after every throw. A heartbeat notices if the opponent drops. |
| Arenas | `js/arenas.js` | 4 arenas drawn in SVG with CSS particles (petals, rain, embers, sparkles). Choose one, or random per round. |
| Sound | `js/audio.js` | Web Audio synth, no sound files. |

Tests: `npm test` (gesture classifier + fight rules).

## Online limits
- PeerJS's free server is a shared community service and occasionally goes down. If it does, rooms can't be created until it's back. You can run your own (`npx peer --port 9000`) and point `js/net.js` at it.
- About 1 in 10 network pairs (strict corporate or campus wifi, some mobile carriers) can't connect directly and need a TURN relay. Add one to the `Peer` options in `js/net.js` if that's a problem.

## Device and browser notes
- Chrome, Edge and Firefox (desktop and Android), and Safari 15.4+ (macOS and iOS).
- First load downloads about 8 MB (tracker WASM and model), cached after that.
- The front camera is mirrored. The ⟲ button switches to the rear camera on phones.
- For 2 players, a laptop webcam at arm's length or more works best. Both hands must fit in the frame.
