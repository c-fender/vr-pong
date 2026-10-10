# Rooftop Cup Pong

GamePigeon-style cup pong on a golden-hour city rooftop. Runs in the browser on phones, desktops and VR headsets (WebXR), with no build step and no assets to download.

## How to play

| Device | Look around | Throw |
|---|---|---|
| Phone | Move/tilt the phone (gyroscope). ◎ re-centers the view. | Swipe up. A faster swipe throws harder, and swiping at an angle aims left or right. |
| VR headset (Quest, etc.) | Your head | Hold the trigger or grip, swing, and let go. The ball takes your hand's speed. |
| Desktop | Arrow keys / WASD | Drag the mouse upward and release |

Rules: you play the CPU, with 2 balls per turn. Sink both and you get the balls back. Cups re-rack at 6, 3 and 1, and the first to clear the other side wins. **Throw power** in the menu adjusts swipe sensitivity.

## Run locally

```bash
npx http-server -c-1 .     # or: python3 -m http.server
```

Open http://localhost:8080. Phones and headsets need **HTTPS** for the gyroscope and WebXR, so deploy it (below) or tunnel it (e.g. `npx localtunnel --port 8080`).

## Deploy (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → `main` / root. Then open `https://<user>.github.io/vr-pong/` on your phone or in the Quest browser and tap **Play in VR**.

## Code map

- `src/physics.js` – custom ball physics (table, floor, cup walls, rims, sinking). Pure JS.
- `src/throw.js` – swipe → launch velocity (fixed arc, speed = power).
- `src/game.js` – turns, balls back, re-racks, CPU opponent.
- `src/controls.js` – gyro look + swipe input. `src/xr.js` – VR controllers.
- `src/environment.js`, `src/table.js`, `src/textures.js` – procedural rooftop, table, cups.
- `tests/physics.test.mjs` – `node tests/physics.test.mjs` checks physics and tuning.
