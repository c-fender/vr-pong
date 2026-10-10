// Phone/desktop controls: device orientation steers the view,
// an upward swipe (touch or mouse) throws the ball, and dragging the top
// part of the screen looks around (works everywhere, gyro or not).
import * as THREE from 'three';
import { VIEW_PITCH } from './constants.js';

const DEFAULT_PITCH = VIEW_PITCH;
const LOOK_ZONE = 0.4; // top 40% of the screen is for looking, the rest for throwing
const zee = new THREE.Vector3(0, 0, 1);
const yAxis = new THREE.Vector3(0, 1, 0);
const xAxis = new THREE.Vector3(1, 0, 0);
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // camera looks out the back of the device
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export function yawPitchOf(q) {
  tmpV.set(0, 0, -1).applyQuaternion(q);
  return { yaw: Math.atan2(-tmpV.x, -tmpV.z), pitch: Math.asin(Math.max(-1, Math.min(1, tmpV.y))) };
}

export class FlatControls {
  constructor(camera, dom, { onThrow, canThrow, canLook, onDrag }) {
    Object.assign(this, { camera, dom, onThrow, canThrow, canLook, onDrag });
    this.dragLook = { yaw: 0, pitch: 0 };
    this.lookDrag = null;
    this.qDragYaw = new THREE.Quaternion();
    this.qDragPitch = new THREE.Quaternion();
    this.gyroEnabled = false;
    this.orientation = null;
    this.needsRecenter = true;
    this.yawOffset = new THREE.Quaternion();
    this.pitchOffset = new THREE.Quaternion();
    this.deviceQ = new THREE.Quaternion();
    this.target = new THREE.Quaternion();
    this.look = { yaw: 0, pitch: DEFAULT_PITCH };
    this.mouse = { x: 0, y: 0 };
    this.keys = new Set();
    this.drag = null;

    dom.addEventListener('pointerdown', (e) => this._down(e));
    dom.addEventListener('pointermove', (e) => this._move(e));
    dom.addEventListener('pointerup', (e) => this._up(e));
    dom.addEventListener('pointercancel', () => this._cancel());
    dom.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    // Some Android browsers only fill in the absolute variant.
    const onOrient = (e) => { if (e.alpha != null && e.beta != null) this.orientation = e; };
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('deviceorientationabsolute', onOrient);
    window.addEventListener('keydown', (e) => this.keys.add(e.key));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
  }

  // iOS needs an explicit permission prompt from a user gesture.
  async enableGyro() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
      }
    } catch { return false; }
    this.gyroEnabled = true;
    this.needsRecenter = true;
    return true;
  }

  get gyroActive() { return this.gyroEnabled && this.orientation != null; }

  recenter() {
    this.needsRecenter = true;
    this.look.yaw = 0;
    this.look.pitch = DEFAULT_PITCH;
    this.dragLook.yaw = 0;
    this.dragLook.pitch = 0;
  }

  update(dt) {
    if (this.gyroActive) {
      const o = this.orientation;
      const screenAngle = THREE.MathUtils.degToRad(screen.orientation?.angle ?? window.orientation ?? 0);
      euler.set(THREE.MathUtils.degToRad(o.beta), THREE.MathUtils.degToRad(o.alpha), -THREE.MathUtils.degToRad(o.gamma), 'YXZ');
      this.deviceQ.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -screenAngle));
      if (this.needsRecenter) {
        // Map however the phone is held right now to "looking at the cups".
        const { yaw, pitch } = yawPitchOf(this.deviceQ);
        this.yawOffset.setFromAxisAngle(yAxis, -yaw);
        this.pitchOffset.setFromAxisAngle(xAxis, THREE.MathUtils.clamp(DEFAULT_PITCH - pitch, -1.3, 1.3));
        this.needsRecenter = false;
        this.camera.quaternion.copy(this.yawOffset).multiply(this.deviceQ).multiply(this.pitchOffset);
      }
      // Drag-to-look adds on top of the phone's own rotation.
      this.qDragYaw.setFromAxisAngle(yAxis, this.dragLook.yaw);
      this.qDragPitch.setFromAxisAngle(xAxis, this.dragLook.pitch);
      this.target.copy(this.qDragYaw).multiply(this.yawOffset).multiply(this.deviceQ)
        .multiply(this.pitchOffset).multiply(this.qDragPitch);
    } else {
      // Desktop: arrow keys, plus a subtle mouse parallax.
      const k = this.keys;
      if (k.has('ArrowLeft') || k.has('a')) this.look.yaw += dt * 0.8;
      if (k.has('ArrowRight') || k.has('d')) this.look.yaw -= dt * 0.8;
      if (k.has('ArrowUp') || k.has('w')) this.look.pitch += dt * 0.6;
      if (k.has('ArrowDown') || k.has('s')) this.look.pitch -= dt * 0.6;
      this.look.yaw = THREE.MathUtils.clamp(this.look.yaw, -1.2, 1.2);
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch, -1, 0.6);
      const mx = this.drag ? 0 : this.mouse.x, my = this.drag ? 0 : this.mouse.y;
      euler.set(this.look.pitch - my * 0.08, this.look.yaw - mx * 0.15, 0, 'YXZ');
      this.target.setFromEuler(euler);
    }
    this.camera.quaternion.slerp(this.target, 1 - Math.exp(-dt * 18));
  }

  _down(e) {
    const lookZone = e.clientY < innerHeight * LOOK_ZONE || e.button === 2;
    if (lookZone || !this.canThrow()) {
      if (!this.canLook()) return;
      this.dom.setPointerCapture?.(e.pointerId);
      this.lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    this.dom.setPointerCapture?.(e.pointerId);
    const pt = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.drag = { id: e.pointerId, start: pt, pts: [pt] };
  }

  _move(e) {
    if (e.pointerType === 'mouse') {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = (e.clientY / innerHeight) * 2 - 1;
    }
    const L = this.lookDrag;
    if (L && e.pointerId === L.id) {
      const dyaw = ((e.clientX - L.x) / innerWidth) * 1.8;
      const dpitch = ((e.clientY - L.y) / innerHeight) * 1.3;
      L.x = e.clientX; L.y = e.clientY;
      const t = this.gyroActive ? this.dragLook : this.look;
      t.yaw = THREE.MathUtils.clamp(t.yaw + dyaw, -1.4, 1.4);
      t.pitch = THREE.MathUtils.clamp(t.pitch + dpitch, this.gyroActive ? -0.9 : -1.1, this.gyroActive ? 0.9 : 0.5);
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const now = performance.now();
    d.pts.push({ x: e.clientX, y: e.clientY, t: now });
    while (d.pts.length > 2 && now - d.pts[0].t > 300) d.pts.shift();
    this.onDrag?.(
      THREE.MathUtils.clamp((e.clientX - d.start.x) / (innerWidth * 0.4), -1, 1),
      THREE.MathUtils.clamp((d.start.y - e.clientY) / innerHeight, 0, 1));
  }

  _up(e) {
    if (this.lookDrag && e.pointerId === this.lookDrag.id) { this.lookDrag = null; return; }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this._cancel();
    const now = performance.now();
    const end = { x: e.clientX, y: e.clientY, t: now };
    // Release velocity: average over the last ~90ms of the swipe.
    let first = d.pts.find((p) => now - p.t <= 90) ?? d.pts[d.pts.length - 1];
    if (first === end || now - first.t < 8) first = d.pts[Math.max(0, d.pts.length - 2)];
    const dtMs = Math.max(8, now - first.t);
    const vy = (first.y - end.y) / dtMs; // px/ms, positive = upward
    const speed = (vy * 1000) / 800; // ~screen-heights/s on a typical phone
    const totalUp = d.start.y - end.y;
    if (totalUp < 40 || speed < 0.3 || !this.canThrow()) return;
    const sideAngle = Math.atan2(end.x - d.start.x, totalUp);
    this.onThrow(speed, sideAngle);
  }

  _cancel() {
    this.drag = null;
    this.lookDrag = null;
    this.onDrag?.(0, 0);
  }
}
