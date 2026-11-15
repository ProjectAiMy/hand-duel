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
| Pause auto-play | **Esc** | same |
| Mute | **M** | same |

Buttons and keys also override the camera during a countdown. **Auto-next** starts the next throw by itself, and pauses after 3 throws in a row with no hands seen.

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
  - The CPU uses its powers now and then. Online, your armed power is hashed with your throw, so your rival can't see it coming.
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
