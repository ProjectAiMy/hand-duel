# Hand Duel: handoff for the next session

Read this file, then CLAUDE.md (rules, run/test/deploy, tuned values). Read README.md only if you need
the feature/architecture detail. You shouldn't need the old chat.

## Where things stand (2026-11-18)
- Everything below is committed and **pushed live** (last commit 599b5a7, https://projectaimy.github.io/hand-duel/).
- None of the work in this list has been tried with a real camera or phone yet. The user is testing it themself.
  Expect feedback on: mask placement, phone frame rate, gesture reads, power-up arming.

## Latest: UI v2 (2026-11-18, committed locally, NOT pushed yet)
- Mockups approved by the user are in `mockups/` (`ui-v2.html?s=landing|denied|menu|game|settings`, plus JPGs).
- New: `js/settings.js`, `js/cursor.js`, `tests/ui.test.mjs`; music in `js/audio.js`; landing, menu, settings, help and
  layout code in `js/main.js` (sections "screens", "camera help", "hand cursor", "settings", "in-game layout").
- User decisions: hold-to-press only (no pinch); spotlight-opponent default; synth music loop; colours and fonts are
  revisited at the very end. Next big phase (later): a pixel-art RPG map where players walk around and challenge each
  other to this duel, with webcam or pixel-avatar fights while hand tracking runs in the background.

## What was built in the session before
1. **Gesture reliability + fouls** (`js/gesture.js`, `js/main.js`): run-based `GestureBuffer` that forgives
   one dropped frame; a 500 ms capture grace while a visible hand hasn't settled. Fouls (`FOULS`): one finger,
   finger gun, three fingers, bad scissors. VS CPU replays the throw with a hint; 2P/online it loses like "too slow".
2. **Compact mobile layout** (`style.css`): fluid text, grid controls, landscape short-height query.
3. **Power-ups** (`POWERS` in `js/fight.js`): shield 👍 (both get one per round), power 👉 finger gun
   (2× damage, earned by 2 wins in a row), reverse 🤘 horns (earned by 2 losses in a row). Armed by holding
   the sign between throws, or with keys Q/W/E (P1) and U/I/O (P2). Online, the power is in the commit hash.
   The finger gun used to read as rock; fixed with index straightness and thumb-raise measures. The shield
   moved from index-up to thumbs up because index-up was unreliable.
4. **Looks** (`js/effects.js`, 🎭 sheet): emoji stickers, background blur/backdrops (selfie segmenter),
   colour filters. These are drawn on a canvas that is sent online in place of the raw camera.
5. **Face masks** (`js/masks.js`, `js/facemesh.js`): war paint, tiger, skull, robot, clown, ninja.
   - Painted in code in MediaPipe's canonical UV space and drawn on the 468-point mesh with WebGL.
   - Eyes and mouth are cut out, the camera's light shades the mask, and the outline fades.
   - Smoothing: an adaptive moving average. Face tracking runs every frame while a mask is on.
   - Verified only on the canonical mesh in the browser pane (front-on and turned 35°).

## Known gaps / next improvements (in rough priority)
- **A hand in front of the face gets painted over by the mask.** Fix idea: cut out the hand area using the
  hand landmarks already tracked in `js/tracker.js`, or the segmenter.
- Phone performance of masks. Fallback idea: run the face model every 2nd frame and extrapolate between.
- Mask art is simple vector paint. To upgrade it, swap in PNG textures painted on MediaPipe's UV layout
  (could be generated offline, e.g. with ComfyUI). `paintMask()` is the only thing to replace.
- Bigger step: 3D avatars (GLB in three.js) driven by the face landmarker's blendshapes, fully in the browser.
- Possible later: cosmetics unlocked by wins (crown for a perfect round), and arena-themed effects.
- Researched and rejected for now:
  - ComfyUI: offline art tool only.
  - LivePortrait: needs a GPU server, licence and deepfake concerns.
  - SadTalker: offline only, stale.
  - Full notes are in Claude's project memory (`looks-ai-avatar-research.md`).

## Key files
| File | What |
|---|---|
| `js/gesture.js` | classify(), FOULS, power signs, GestureBuffer |
| `js/fight.js` | pure fight rules, POWERS, snapshot/restore (mirrored online) |
| `js/main.js` | game flow, capture timing, arming, look picker, online glue |
| `js/net.js` | PeerJS commit-reveal online play |
| `js/effects.js` | looks pipeline (segmenter, stickers, filters, calls masks) |
| `js/masks.js` | MASKS, paintMask(), maskThumb(), MaskRenderer (WebGL) |
| `js/facemesh.js` | generated UV + triangle data (from canonical_face_model.obj) |
| `tests/*.test.mjs` | `npm test`: gesture, fight, sha256 |

## Working rules (from the user)
- Commit locally, but **ask before `git push`** (a push updates the live site).
- Test on port 8100 (`rps-cam-test` in `.claude/launch.json`); the user often runs their own server on 8000.
  The HTTPS port for phones is the HTTP port + 443 (8543 when serving on 8100).
- The user often says they'll run tests themself. Don't commit videos (rockpaper.mp4).
