# Rooftop Cup Pong

GamePigeon-style cup pong on a golden-hour city rooftop. Runs in the browser on phones, desktops and VR headsets (WebXR), with no build step and no assets to download.

## How to play

| Device | Look around | Throw |
|---|---|---|
| Phone | Move/tilt the phone (gyroscope). ◎ re-centers the view. | Swipe up. A faster swipe throws harder, and swiping at an angle aims left or right. |
| VR headset (Quest, etc.) | Your head | Hold the trigger or grip, swing, and let go. The ball takes your hand's speed. |
| Desktop | Arrow keys / WASD | Drag the mouse upward and release |

Phones play upright (portrait) by default and also work sideways (landscape).

**Modes**
- **vs CPU**: easy, medium or hard.
- **Pass & Play**: two players on one phone. The view flies to the other end of the table each turn.
- **Online**: one player taps *Create a room* and shares the 5-letter code (or the `?join=CODE` invite link). The other enters it. Uses WebRTC via the free PeerJS server; inside a claude.ai artifact it uses the artifact's live room instead.

Rules: 2 balls per turn. Sink both and you get the balls back. Cups re-rack at 6, 3 and 1, and the first to clear the other side wins. **Throw power** in the menu adjusts swipe sensitivity.

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
- `src/game.js` – turns, balls back, re-racks, CPU opponent, multiplayer sides.
- `src/net.js` – online play (PeerJS / artifact room / `?net=local` test channel) with acks and resends.
- `src/controls.js` – gyro look + swipe input. `src/xr.js` – VR controllers.
- `src/environment.js`, `src/table.js`, `src/textures.js` – procedural rooftop, table, cups.
- `tests/physics.test.mjs` – `node tests/physics.test.mjs` checks physics and tuning.
