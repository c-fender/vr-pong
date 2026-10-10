// Turn logic: you vs CPU, 2 balls per turn, balls back when both sink,
// re-racks at 6/3/1 cups, first to clear the other side wins.
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

export class Game {
  constructor({ scene, camera, cups, sfx, ui, board }) {
    Object.assign(this, { scene, camera, cups, sfx, ui, board });
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
    this.score = { player: 0, cpu: 0 };
    this.difficulty = 'medium';
    this.strength = 1;
    this.pending = null;
    this.flash = null;
    this.xr = null;
    this.xrHand = null;
    this.ballsLeft = 2;
    this.shooter = 'player';
  }

  start(difficulty = this.difficulty) {
    this.difficulty = difficulty;
    this.score = { player: 0, cpu: 0 };
    this.racked = { player: new Set(), cpu: new Set() };
    for (const side of ['cpu', 'player']) {
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
    this.shooter = 'player';
    this.ballsLeft = 2;
    this.madeThisTurn = 0;
    this.state = 'aim';
    this._toast('Your turn');
    this.ui.gameOver(null);
  }

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
    p.set(p.x - Math.sin(yaw) * -LAUNCH_OFFSET.z, LAUNCH_OFFSET.y, p.z + Math.cos(yaw) * LAUNCH_OFFSET.z);
    this._launch(p, v, 'player');
  }

  // VR: grab with trigger/grip, release to throw with the hand's velocity.
  xrGrab(hand) {
    if (this.state === 'over') { this.start(); return; }
    if (!this.canPlayerThrow() || this.xrHand) return;
    this.xrHand = hand;
    this.ball.visible = true;
    this.xr.pulse(hand, 0.25, 30);
  }

  xrRelease(hand) {
    if (this.xrHand !== hand) return;
    this.xrHand = null;
    const v = this.xr.velocity(hand);
    if (v.length() < 0.6) { this.ball.visible = false; return; } // just let go, no throw
    this._launch(this.xr.ballPosition(hand), v, 'player');
    this.xr.pulse(hand, 0.5, 40);
  }

  _launch(p, v, shooter) {
    this.shooter = shooter;
    const targetSide = shooter === 'player' ? 'cpu' : 'player';
    this.targets = this.cups.filter((c) => c.side === targetSide && c.active);
    this.sim.launch({ x: p.x, y: p.y, z: p.z }, { x: v.x, y: v.y, z: v.z });
    this.ball.position.copy(p);
    this.ball.visible = true;
    this.state = 'flight';
    this.sfx.throw();
  }

  _cpuThrow() {
    const cups = this.cups.filter((c) => c.side === 'player' && c.active);
    const target = cups[Math.floor(Math.random() * cups.length)];
    const from = { x: (Math.random() - 0.5) * 0.2, y: 1.28 + Math.random() * 0.08, z: -TABLE.length / 2 - 0.35 };
    const v = solveLaunch(from, { x: target.x, y: TABLE.height + CUP.height + 0.01, z: target.z }, 0.78 + Math.random() * 0.12);
    const s = DIFFICULTY[this.difficulty];
    this._launch(from, { x: v.x + gauss() * s, y: v.y + gauss() * s, z: v.z + gauss() * s }, 'cpu');
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
      if (!this.sim.active) this._resolve();
    }

    this.held.visible = this.mode === 'flat' && this.state === 'aim';
    this._updateStatus();
  }

  _resolve() {
    const shooter = this.shooter;
    this.state = 'settle';
    if (this.sim.result === 'made') {
      const cup = this.sim.sunkCup;
      this.score[shooter]++;
      this.madeThisTurn++;
      cup.active = false;
      cup.removing = 0;
      const b = new THREE.Mesh(this.ball.geometry, this.ball.material);
      b.position.set(this.sim.p.x - cup.x, CUP.liquidH + BALL_R * 0.55, this.sim.p.z - cup.z);
      cup.mesh.add(b);
      cup.ballInCup = b;
      this.ball.visible = false;
      this.sfx.sink();
      if (shooter === 'player') {
        this._toast(MADE_LINES[Math.floor(Math.random() * MADE_LINES.length)], 'good');
        navigator.vibrate?.(40);
        this.xr?.hands.forEach((h) => this.xr.pulse(h, 0.6, 80));
      } else {
        this._toast('CPU sinks one', 'bad');
      }
    } else {
      this._toast(shooter === 'player' ? 'Miss' : 'CPU misses', 'dim');
    }
    this.ballsLeft--;
    this._wait(1.0, () => { this.ball.visible = false; this._afterBall(); });
  }

  _afterBall() {
    const opp = this.shooter === 'player' ? 'cpu' : 'player';
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
    if (opp === 'player') this._toast('Your turn');
    else this._toast("CPU's turn", 'dim');
    this._nextBall(0.7);
  }

  _nextBall(delay = 0) {
    if (this.shooter === 'player') { this.state = 'aim'; return; }
    this.state = 'cpu';
    this._wait(0.9 + delay, () => this._cpuThrow());
  }

  _remaining(side) { return this.cups.filter((c) => c.side === side && c.active).length; }

  _rerack(side) {
    const active = this.cups.filter((c) => c.side === side && c.active);
    const n = active.length;
    if (!RERACK_COUNTS.includes(n) || this.racked[side].has(n)) return;
    this.racked[side].add(n);
    const free = formationPositions(n, side);
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
    if (winner === 'player') { this._toast('You win!', 'good'); this.sfx.cheer(); }
    else this._toast('CPU wins', 'bad');
    this.ui.gameOver(winner === 'player');
  }

  _wait(t, fn) { this.pending = { t, fn }; }

  _toast(text, kind = '') {
    this.flash = { text, t: 1.6 };
    this.ui.toast(text, kind);
  }

  _updateStatus() {
    const vr = this.mode === 'vr';
    let line1 = '', line2 = '';
    switch (this.state) {
      case 'menu': line1 = 'Rooftop Cup Pong'; line2 = 'Choose a mode to start'; break;
      case 'aim':
        line1 = `Your throw · ball ${3 - this.ballsLeft} of 2`;
        line2 = vr ? 'Hold trigger, swing and let go' : 'Swipe up to throw — faster = harder';
        break;
      case 'flight': case 'settle':
        line1 = this.shooter === 'player' ? 'Your throw' : 'CPU throwing'; break;
      case 'cpu': line1 = "CPU's turn"; break;
      case 'over':
        line1 = this.score.player > this.score.cpu ? 'You win!' : 'CPU wins';
        line2 = vr ? 'Pull the trigger to play again' : 'Tap Play again';
        break;
    }
    if (this.flash) line1 = this.flash.text;
    const you = this.score.player, cpu = this.score.cpu;
    this.board.update({ you, cpu, line1, line2 });
    this.ui.status({
      you, cpu,
      turn: this.state === 'aim' || this.shooter === 'player' ? 'Your turn' : "CPU's turn",
      balls: this.shooter === 'player' ? this.ballsLeft : 0,
      hint: this.state === 'aim' ? line2 : '',
    });
  }
}
