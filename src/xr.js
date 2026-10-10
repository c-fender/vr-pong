// VR controllers: grab with trigger or grip, throw by releasing mid-swing.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const HOLD_OFFSET = new THREE.Vector3(0, -0.01, -0.06);
const VELOCITY_WINDOW_MS = 90;

export class XRControls {
  constructor(renderer, rig, { onGrab, onRelease }) {
    this.hands = [];
    const factory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const ctrl = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      rig.add(ctrl, grip);
      const hand = { i, ctrl, grip, history: [], gamepad: null };
      ctrl.addEventListener('connected', (e) => { hand.gamepad = e.data.gamepad; });
      ctrl.addEventListener('disconnected', () => { hand.gamepad = null; hand.history.length = 0; });
      for (const ev of ['selectstart', 'squeezestart']) ctrl.addEventListener(ev, () => onGrab(hand));
      for (const ev of ['selectend', 'squeezeend']) ctrl.addEventListener(ev, () => onRelease(hand));
      this.hands.push(hand);
    }
  }

  ballPosition(hand, out = new THREE.Vector3()) {
    return hand.grip.localToWorld(out.copy(HOLD_OFFSET));
  }

  // Track the held-ball point (not just the grip) so wrist flicks count.
  update() {
    const now = performance.now();
    for (const h of this.hands) {
      h.history.push({ p: this.ballPosition(h), t: now });
      while (h.history.length > 2 && now - h.history[0].t > 200) h.history.shift();
    }
  }

  velocity(hand) {
    const hist = hand.history;
    if (hist.length < 2) return new THREE.Vector3();
    const last = hist[hist.length - 1];
    const first = hist.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? hist[0];
    const dt = Math.max(1, last.t - first.t) / 1000;
    return last.p.clone().sub(first.p).divideScalar(dt);
  }

  pulse(hand, intensity, ms) {
    try { hand?.gamepad?.hapticActuators?.[0]?.pulse(intensity, ms); } catch { /* unsupported */ }
  }
}
