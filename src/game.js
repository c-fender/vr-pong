// Turn logic: 2 balls per turn, balls back when both sink, re-racks at
// 6/3/1 cups, first to clear the other side wins.
//
// The table has two ends: 'near' (+z) and 'far' (-z). Each end is driven by
// a controller: 'local' (this device), 'cpu', or 'remote' (online friend).
//   vs CPU:      near=local, far=cpu
//   pass & play: near=local, far=local (view flips to whoever is shooting)
//   online:      host is near, guest is far; the other end is 'remote'
import * as THREE from 'three';
import { BallSim, solveLaunch } from './physics.js';
import { TABLE, CUP, BALL_R, EYE_HEIGHT } from './constants.js';
import { formationPositions, RERACK_COUNTS } from './rack.js';
import { swipeToVelocity } from './throw.js';
import { createBallMesh } from './table.js';
import { yawPitchOf } from './controls.js';

export const DIFFICULTY = { easy: 0.12, medium: 0.07, hard: 0.035 };
const HOLD_OFFSET = new THREE.Vector3(0, -0.1, -0.45);
// Swipe throws launch from a fixed point in front of the player (rotated by
// view yaw only), so phone tilt never changes how far a given swipe goes.
export const LAUNCH_OFFSET = { y: EYE_HEIGHT - 0.19, z: -0.42 };
const MADE_LINES = ['Splash!', 'Nice shot!', 'Cup!', 'Money!', 'Drink up!'];
const tmpQ = new THREE.Quaternion();
const axis = new THREE.Vector3();
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
const ease = (t) => t * t * (3 - 2 * t);
const other = (side) => (side === 'near' ? 'far' : 'near');
const round = (o) => ({ x: +o.x.toFixed(5), y: +o.y.toFixed(5), z: +o.z.toFixed(5) });

export class Game {
  constructor({ scene, camera, cups, sfx, ui, boards }) {
    Object.assign(this, { scene, camera, cups, sfx, ui, boards });
    this.ball = createBallMesh();
    this.ball.visible = false;
    scene.add(this.ball);
    this.held = createBallMesh();
    this.held.castShadow = false;
    this.held.visible = false;
    this.held.position.copy(HOLD_OFFSET);
    camera.add(this.held);
    this.sim = new BallSim();
    this.state = 'menu';
    this.mode = 'flat';
    this.play = 'cpu';
    this.control = { near: 'local', far: 'cpu' };
    this.names = { near: 'You', far: 'CPU' };
    this.localSide = 'near';
    this.score = { near: 0, far: 0 };
    this.difficulty = 'medium';
    this.strength = 1;
    this.pending = null;
    this.flash = null;
    this.xr = null;
    this.xrHand = null;
    this.net = null;
    this.ballsLeft = 2;
    this.shooter = 'near';
    this.onViewChange = null;
  }

  // play: 'cpu' | 'pass' | 'online'
  start({ play = this.play, difficulty = this.difficulty, localSide = 'near' } = {}) {
    this.play = play;
    this.difficulty = difficulty;
    this.localSide = play === 'online' ? localSide : 'near';
    if (play === 'cpu') {
      this.control = { near: 'local', far: 'cpu' };
      this.names = { near: 'You', far: 'CPU' };
    } else if (play === 'pass') {
      this.control = { near: 'local', far: 'local' };
      this.names = { near: 'Player 1', far: 'Player 2' };
    } else {
      const remote = other(this.localSide);
      this.control = { [this.localSide]: 'local', [remote]: 'remote' };
      this.names = { [this.localSide]: 'You', [remote]: 'Friend' };
    }
    this.score = { near: 0, far: 0 };
    this.racked = { near: new Set(), far: new Set() };
    for (const side of ['far', 'near']) {
      const pos = formationPositions(10, side);
      this.cups.filter((c) => c.side === side).forEach((c, i) => {
        Object.assign(c, { x: pos[i].x, z: pos[i].z, active: true, removing: null, move: null });
        c.mesh.visible = true;
        c.mesh.scale.setScalar(1);
        if (c.ballInCup) { c.mesh.remove(c.ballInCup); c.ballInCup = null; }
      });
    }
    this.pending = null;
    this.ball.visible = false;
    this.xrHand = null;
    this.authResult = null;
    this.queuedThrow = null;
    this.shooter = 'near';
    this.ballsLeft = 2;
    this.madeThisTurn = 0;
    this.ui.gameOver(null);
    this.onViewChange?.(this.viewSide, true);
    this._announceTurn();
    this._nextBall(0.4);
  }

  // Which end of the table this screen looks from.
  get viewSide() { return this.play === 'pass' ? this.shooter : this.localSide; }

  canPlayerThrow() { return this.state === 'aim'; }

  setHoldDrag(x, lift) {
    this.held.position.set(HOLD_OFFSET.x + x * 0.06, HOLD_OFFSET.y + lift * 0.05, HOLD_OFFSET.z);
  }

  // Phone / desktop: upward swipe.
  swipeThrow(speed, sideAngle) {
    if (!this.canPlayerThrow()) return;
    const { yaw } = yawPitchOf(this.camera.getWorldQuaternion(tmpQ));
    const v = swipeToVelocity(speed, yaw, sideAngle, this.strength);
    const p = this.camera.getWorldPosition(new THREE.Vector3());
    p.set(p.x + Math.sin(yaw) * LAUNCH_OFFSET.z, LAUNCH_OFFSET.y, p.z + Math.cos(yaw) * LAUNCH_OFFSET.z);
    this._localLaunch(p, v);
  }

  // VR: grab with trigger/grip, release to throw with the hand's velocity.
  xrGrab(hand) {
    if (this.state === 'over' && this.play !== 'online') { this.start(); return; }
    if (!this.canPlayerThrow() || this.xrHand) return;
    this.xrHand = hand;
    this.ball.visible = true;
    this.xr.pulse(hand, 0.25, 30);
  }

  xrRelease(hand) {
    if (this.xrHand !== hand) return;
    this.xrHand = null;
    const v = this.xr.velocity(hand);
    if (v.length() < 0.6 || !this.canPlayerThrow()) { this.ball.visible = false; return; }
    this._localLaunch(this.xr.ballPosition(hand), v);
    this.xr.pulse(hand, 0.5, 40);
  }

  _localLaunch(p, v) {
    const msg = { t: 'throw', p: round(p), v: round(v) };
    if (this.play === 'online') this.net?.send(msg);
    this._launch(msg.p, msg.v);
  }

  _launch(p, v, remote = false) {
    this.targets = this.cups.filter((c) => c.side === other(this.shooter) && c.active);
    this.sim.launch({ x: p.x, y: p.y, z: p.z }, { x: v.x, y: v.y, z: v.z });
    this.ball.position.set(p.x, p.y, p.z);
    this.ball.visible = true;
    this.remoteFlight = remote;
    this.state = 'flight';
    this.sfx.throw();
  }

  // Messages from the online opponent.
  onNet(msg) {
    if (msg.t === 'throw') {
      if (this.state === 'remote') this._launch(msg.p, msg.v, true);
      else this.queuedThrow = msg;
    } else if (msg.t === 'result') {
      this.authResult = msg;
    }
  }

  _cpuThrow() {
    const cups = this.cups.filter((c) => c.side === other(this.shooter) && c.active);
    const target = cups[Math.floor(Math.random() * cups.length)];
    const dir = this.shooter === 'far' ? -1 : 1;
    const from = { x: (Math.random() - 0.5) * 0.2, y: 1.28 + Math.random() * 0.08, z: dir * (TABLE.length / 2 + 0.35) };
    const v = solveLaunch(from, { x: target.x, y: TABLE.height + CUP.height + 0.01, z: target.z }, 0.78 + Math.random() * 0.12);
    const s = DIFFICULTY[this.difficulty];
    this._launch(from, { x: v.x + gauss() * s, y: v.y + gauss() * s, z: v.z + gauss() * s });
  }

  update(dt) {
    this._updateCups(dt);
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) { const fn = this.pending.fn; this.pending = null; fn(); }
    }
    if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) this.flash = null; }
    if (this.xrHand) this.xr.ballPosition(this.xrHand, this.ball.position);

    if (this.state === 'flight') {
      for (const e of this.sim.step(dt, this.targets)) {
        if (e.type === 'bounce') this.sfx.bounce(e.surface, e.speed);
      }
      const { p, v } = this.sim;
      this.ball.position.set(p.x, p.y, p.z);
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.01) this.ball.rotateOnWorldAxis(axis.set(v.z, 0, -v.x).normalize(), (sp * dt) / BALL_R);
      if (!this.sim.active) {
        // The thrower's device decides the outcome of online throws.
        if (this.remoteFlight) this.state = 'remote-wait';
        else this._resolve(this.sim.result, this.sim.sunkCup, this.sim.p);
      }
    }
    if (this.state === 'remote-wait' && this.authResult) {
      const r = this.authResult;
      this.authResult = null;
      this._resolve(r.result, this.cups.find((c) => c.id === r.cup) ?? null, r.p);
    }

    this.held.visible = this.mode === 'flat' && this.state === 'aim';
    this._updateStatus();
  }

  _resolve(result, cup, p) {
    const shooter = this.shooter;
    const name = this.names[shooter];
    const isLocal = this.control[shooter] === 'local';
    if (this.play === 'online' && isLocal) {
      this.net?.send({ t: 'result', result, cup: cup?.id ?? null, p: round(p) });
    }
    this.state = 'settle';
    if (result === 'made' && cup?.active) {
      this.score[shooter]++;
      this.madeThisTurn++;
      cup.active = false;
      cup.removing = 0;
      const b = new THREE.Mesh(this.ball.geometry, this.ball.material);
      const dx = THREE.MathUtils.clamp(p.x - cup.x, -0.02, 0.02), dz = THREE.MathUtils.clamp(p.z - cup.z, -0.02, 0.02);
      b.position.set(dx, CUP.liquidH + BALL_R * 0.55, dz);
      cup.mesh.add(b);
      cup.ballInCup = b;
      this.ball.visible = false;
      this.sfx.sink();
      if (isLocal) {
        const line = MADE_LINES[Math.floor(Math.random() * MADE_LINES.length)];
        this._toast(this.play === 'pass' ? `${name}: ${line}` : line, 'good');
        navigator.vibrate?.(40);
        this.xr?.hands.forEach((h) => this.xr.pulse(h, 0.6, 80));
      } else {
        this._toast(`${name} sinks one`, 'bad');
      }
    } else {
      this._toast(isLocal && this.play !== 'pass' ? 'Miss' : `${name} misses`, 'dim');
    }
    this.ballsLeft--;
    this._wait(1.0, () => { this.ball.visible = false; this._afterBall(); });
  }

  _afterBall() {
    const opp = other(this.shooter);
    if (this._remaining(opp) === 0) return this._gameOver(this.shooter);
    if (this.ballsLeft > 0) return this._nextBall();
    if (this.madeThisTurn >= 2) {
      this.ballsLeft = 2;
      this.madeThisTurn = 0;
      this._toast('Balls back!', 'good');
      this.sfx.cheer();
      return this._nextBall(0.6);
    }
    this._rerack(opp);
    this.shooter = opp;
    this.ballsLeft = 2;
    this.madeThisTurn = 0;
    if (this.play === 'pass') this.onViewChange?.(this.viewSide, false);
    this._announceTurn();
    this._nextBall(this.play === 'pass' ? 1.4 : 0.7);
  }

  _announceTurn() {
    const ctl = this.control[this.shooter];
    if (this.play === 'pass') this._toast(`${this.names[this.shooter]}'s turn`);
    else if (ctl === 'local') this._toast('Your turn');
    else this._toast(`${this.names[this.shooter]}'s turn`, 'dim');
  }

  _nextBall(delay = 0) {
    const ctl = this.control[this.shooter];
    if (ctl === 'local') {
      // Brief lock so the view settles (and the phone can be passed).
      this.state = 'wait';
      this._wait(delay, () => { this.state = 'aim'; });
    } else if (ctl === 'cpu') {
      this.state = 'cpu';
      this._wait(0.9 + delay, () => this._cpuThrow());
    } else {
      this.state = 'remote';
      if (this.queuedThrow) {
        const q = this.queuedThrow;
        this.queuedThrow = null;
        this._launch(q.p, q.v, true);
      }
    }
  }

  _remaining(side) { return this.cups.filter((c) => c.side === side && c.active).length; }

  _rerack(side) {
    const active = this.cups.filter((c) => c.side === side && c.active);
    const n = active.length;
    if (!RERACK_COUNTS.includes(n) || this.racked[side].has(n)) return;
    this.racked[side].add(n);
    const free = formationPositions(n, side);
    // Deterministic order so both online players get identical racks.
    active.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const c of active) {
      let best = 0, bestD = Infinity;
      free.forEach((p, i) => { const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2; if (d < bestD) { bestD = d; best = i; } });
      const [p] = free.splice(best, 1);
      c.move = { fx: c.x, fz: c.z, tx: p.x, tz: p.z, t: 0 };
    }
    this._toast('Re-rack!');
  }

  _updateCups(dt) {
    for (const c of this.cups) {
      if (c.move) {
        c.move.t = Math.min(1, c.move.t + dt / 0.7);
        const k = ease(c.move.t);
        c.x = c.move.fx + (c.move.tx - c.move.fx) * k;
        c.z = c.move.fz + (c.move.tz - c.move.fz) * k;
        if (c.move.t >= 1) c.move = null;
      }
      let y = TABLE.height;
      if (c.removing !== null) {
        c.removing += dt;
        const k = Math.max(0, (c.removing - 0.6) / 0.5);
        y += ease(Math.min(1, k)) * 0.18;
        c.mesh.scale.setScalar(Math.max(0.001, 1 - k));
        if (k >= 1) { c.mesh.visible = false; c.removing = null; }
      }
      c.mesh.position.set(c.x, y, c.z);
    }
  }

  _gameOver(winner) {
    this.state = 'over';
    this.winner = winner;
    const localWin = this.control[winner] === 'local';
    const text = this.play === 'pass' ? `${this.names[winner]} wins!`
      : localWin ? 'You win!' : `${this.names[winner]} wins`;
    this._toast(text, localWin ? 'good' : 'bad');
    if (localWin) this.sfx.cheer();
    this.ui.gameOver(text);
  }

  _wait(t, fn) { this.pending = { t, fn }; }

  _toast(text, kind = '') {
    this.flash = { text, t: 1.6 };
    this.ui.toast(text, kind);
  }

  _statusLines(viewer) {
    const vr = this.mode === 'vr';
    const name = this.names[this.shooter];
    const mine = this.control[this.shooter] === 'local' && (this.play === 'pass' || this.shooter === viewer);
    let line1 = '', line2 = '';
    switch (this.state) {
      case 'menu': line1 = 'Rooftop Cup Pong'; line2 = 'Choose a mode to start'; break;
      case 'aim': case 'wait':
        line1 = `${this.play === 'pass' ? name : 'Your'} throw · ball ${3 - this.ballsLeft} of 2`;
        line2 = vr ? 'Hold trigger, swing and let go' : 'Swipe up to throw — faster = harder';
        break;
      case 'flight': case 'settle': case 'remote-wait':
        line1 = mine && this.play !== 'pass' ? 'Your throw' : `${name} throwing`; break;
      case 'cpu': case 'remote': line1 = `${name}'s turn`; break;
      case 'over':
        line1 = this.play === 'pass' || this.control[this.winner] !== 'local' ? `${this.names[this.winner]} wins` : 'You win!';
        line2 = this.play === 'online' ? 'Open the menu for a rematch' : vr ? 'Pull the trigger to play again' : 'Tap Play again';
        break;
    }
    if (this.flash) line1 = this.flash.text;
    return { line1, line2 };
  }

  _updateStatus() {
    // Each scoreboard faces one end of the table and lists that end first.
    for (const side of ['near', 'far']) {
      const { line1, line2 } = this._statusLines(side);
      const opp = other(side);
      this.boards[side].update({
        leftName: this.names[side], leftScore: this.score[side],
        rightName: this.names[opp], rightScore: this.score[opp], line1, line2,
      });
    }
    const view = this.viewSide, opp = other(view);
    const { line2 } = this._statusLines(view);
    const turnLocal = this.control[this.shooter] === 'local';
    this.ui.status({
      leftName: this.names[view], leftScore: this.score[view],
      rightName: this.names[opp], rightScore: this.score[opp],
      turn: this.state === 'menu' ? '' : turnLocal && this.play !== 'pass' ? 'Your turn' : `${this.names[this.shooter]}'s turn`,
      balls: turnLocal ? this.ballsLeft : 0,
      hint: this.state === 'aim' ? line2 : '',
    });
  }
}
