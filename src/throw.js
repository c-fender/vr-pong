// GamePigeon-style throw: fixed launch arc, swipe speed sets power,
// sideways swipe angle nudges aim. `speed` is in screen-heights per second.
const ELEVATION = 0.9; // ~52 degrees
const BASE = 3.38;
const GAIN = 0.45;

export function swipeToVelocity(speed, yaw, sideAngle, strength = 1) {
  const v = Math.min(Math.max(BASE + GAIN * speed * strength, 1.5), 8);
  const a = yaw + Math.max(-0.35, Math.min(0.35, sideAngle * 0.55));
  const c = Math.cos(ELEVATION) * v;
  return { x: -Math.sin(a) * c, y: Math.sin(ELEVATION) * v, z: -Math.cos(a) * c };
}
