# Hand Duel: notes for Claude

Webcam Rock-Paper-Scissors with a fighting-game format. Plain HTML/JS ES modules, no build step.
README.md explains the features, controls, rules and architecture, so read it first.

## Run and test
- `python3 serve.py` serves http://localhost:8000 (no-cache) and also https://<wifi-ip>:8443 with a
  self-signed cert in `.cert/` (gitignored), so phones on the same wifi get the camera.
  `/lan.json` gives the game that wifi URL for invite links.
- `.claude/launch.json` (`rps-cam`) uses port 8000. The user often has their own server on 8000 already,
  so test on another port (`python3 serve.py 8100`) instead of stopping theirs.
- `npm test` runs the gesture classifier, fight rules and JS SHA-256 tests (node --test).
- The browser pane can't use the camera or a self-signed cert. To test online play there, open two tabs with
  the camera unticked and throw with the `#manualL [data-throw=…]` buttons.

## Deploy
- Live at https://projectaimy.github.io/hand-duel/ via GitHub Pages (branch `main`, root, with `.nojekyll`).
- Remote: https://github.com/ProjectAiMy/hand-duel. `git push` publishes in about a minute. The user's token is in
  the macOS keychain. There's no `gh` CLI, no Homebrew and no SSH key on this Mac.
- Ask before pushing: it changes the public site.

## Things that were tuned with the user
- Capture timing is in `js/main.js`: `CAPTURE_BEFORE = 0`, `CAPTURE_AFTER = 700` ms after "Shoot!".
  `GestureBuffer.settled()` takes the *last* gesture held for 3+ frames, so the fist pumped during the
  countdown doesn't count. The user found reading it too early annoying.
- `NEXT_DELAY_S = 3`: a countdown before auto-next.
- Online uses PeerJS 1.5.4 cloud signalling with peer ids `handduel-v1-CODE`, commit-reveal throws, the host as
  the source of truth, and a heartbeat. `sha256` falls back to the pure-JS version on plain http, where crypto.subtle is missing.

## Not yet verified
- Two-hand tracking with a real camera in 2-player mode.
- Online play between two real devices with cameras, and the self-signed HTTPS LAN path on a phone.

## Other
- `rockpaper.mp4` in the folder is the user's gameplay recording (gitignored). Don't commit videos.
- `/Users/suriaol/.git` is an empty, stray repo covering the home folder. Removing it is up to the user.
