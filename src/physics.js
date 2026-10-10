// Lightweight ball physics tuned for cup pong. Pure JS (no three.js) so it can
// be tested in Node. Cups are modelled as truncated-cone shells with a torus rim.
import { TABLE, CUP, BALL_R, GRAVITY } from './constants.js';

const SUBSTEP = 1 / 720;
const DRAG = 0.12;
const E_TABLE = 0.78;
const E_FLOOR = 0.55;
const E_RIM = 0.45;
const E_WALL = 0.35;
const SLOPE = (CUP.topR - CUP.bottomR) / CUP.height;
const NLEN = Math.hypot(1, SLOPE);

export function cupRadiusAt(h) {
  const k = Math.min(Math.max(h / CUP.height, 0), 1);
  return CUP.bottomR + (CUP.topR - CUP.bottomR) * k;
}

export class BallSim {
  constructor() {
    this.p = { x: 0, y: 0, z: 0 };
    this.v = { x: 0, y: 0, z: 0 };
    this.active = false;
    this.result = null;
    this.sunkCup = null;
  }

  launch(p, v) {
    Object.assign(this.p, p);
    Object.assign(this.v, v);
    this.active = true;
    this.result = null;
    this.sunkCup = null;
    this.time = 0;
    this.restTime = 0;
    this.lowTime = 0;
  }

  // cups: [{ x, z, active }]. Returns collision/result events for audio + logic.
  step(dt, cups) {
    const events = [];
    let t = dt;
    while (t > 1e-9 && this.active) {
      const h = Math.min(SUBSTEP, t);
      this._sub(h, cups, events);
      t -= h;
    }
    return events;
  }

  _end(result, events, cup = null) {
    this.active = false;
    this.result = result;
    this.sunkCup = cup;
    events.push({ type: result, cup });
  }

  _sub(h, cups, events) {
    const p = this.p, v = this.v;
    const px = p.x, py = p.y, pz = p.z;

    v.y -= GRAVITY * h;
    const k = 1 - DRAG * h;
    v.x *= k; v.y *= k; v.z *= k;
    p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;

    // Table top.
    const top = TABLE.height;
    const overTable = Math.abs(p.x) <= TABLE.width / 2 && Math.abs(p.z) <= TABLE.length / 2;
    if (overTable && p.y - BALL_R < top && py - BALL_R >= top - 0.005) {
      p.y = top + BALL_R;
      if (v.y < 0) {
        const s = -v.y;
        v.y = s * E_TABLE;
        if (v.y < 0.15) v.y = 0;
        v.x *= 0.985; v.z *= 0.985;
        if (s > 0.25) events.push({ type: 'bounce', surface: 'table', speed: s });
      }
      if (v.y === 0) { const f = 1 - 0.8 * h; v.x *= f; v.z *= f; }
    }

    // Floor.
    if (p.y - BALL_R < 0) {
      p.y = BALL_R;
      if (v.y < 0) {
        const s = -v.y;
        v.y = s * E_FLOOR;
        if (v.y < 0.2) v.y = 0;
        v.x *= 0.85; v.z *= 0.85;
        if (s > 0.4) events.push({ type: 'bounce', surface: 'floor', speed: s });
      }
      if (v.y === 0) { const f = 1 - 2.5 * h; v.x *= f; v.z *= f; }
    }

    for (const cup of cups) {
      if (cup.active) this._cup(cup, px, py, pz, events);
      if (!this.active) return;
    }

    this.time += h;
    const sp2 = v.x * v.x + v.y * v.y + v.z * v.z;
    this.restTime = sp2 < 0.0025 ? this.restTime + h : 0;
    this.lowTime = p.y < top - 0.05 ? this.lowTime + h : 0;
    if (this.restTime > 0.4 || this.lowTime > 0.7 || this.time > 7 ||
        Math.abs(p.x) > 10 || Math.abs(p.z) > 10) {
      this._end('miss', events);
    }
  }

  _cup(cup, px, py, pz, events) {
    const p = this.p, v = this.v;
    const base = TABLE.height;
    let dx = p.x - cup.x, dz = p.z - cup.z;
    const reach = CUP.topR + BALL_R + CUP.rimR + 0.01;
    if (dx * dx + dz * dz > reach * reach) return;
    let hgt = p.y - base;
    if (hgt > CUP.height + BALL_R + CUP.rimR + 0.01 || hgt < -BALL_R) return;

    let rr = Math.hypot(dx, dz);
    let ux = 1, uz = 0;
    if (rr > 1e-6) { ux = dx / rr; uz = dz / rr; }

    // Rim (torus).
    const qx = cup.x + ux * CUP.topR, qy = base + CUP.height, qz = cup.z + uz * CUP.topR;
    const ddx = p.x - qx, ddy = p.y - qy, ddz = p.z - qz;
    const dist = Math.hypot(ddx, ddy, ddz);
    const minD = BALL_R + CUP.rimR;
    if (dist < minD && dist > 1e-6) {
      const nx = ddx / dist, ny = ddy / dist, nz = ddz / dist;
      p.x = qx + nx * minD; p.y = qy + ny * minD; p.z = qz + nz * minD;
      const vn = v.x * nx + v.y * ny + v.z * nz;
      if (vn < 0) {
        v.x -= (1 + E_RIM) * vn * nx; v.y -= (1 + E_RIM) * vn * ny; v.z -= (1 + E_RIM) * vn * nz;
        // Damp tangential speed a little.
        const vn2 = v.x * nx + v.y * ny + v.z * nz;
        v.x = (v.x - vn2 * nx) * 0.92 + vn2 * nx;
        v.y = (v.y - vn2 * ny) * 0.92 + vn2 * ny;
        v.z = (v.z - vn2 * nz) * 0.92 + vn2 * nz;
        if (-vn > 0.2) events.push({ type: 'bounce', surface: 'rim', speed: -vn });
      }
      dx = p.x - cup.x; dz = p.z - cup.z; hgt = p.y - base;
      rr = Math.hypot(dx, dz);
      if (rr > 1e-6) { ux = dx / rr; uz = dz / rr; }
    }

    // Walls.
    if (hgt <= 0 || hgt >= CUP.height) return;
    const wasInside = Math.hypot(px - cup.x, pz - cup.z) < cupRadiusAt(py - base);
    const R = cupRadiusAt(hgt);

    if (!wasInside) {
      if (rr < R + BALL_R) {
        const target = R + BALL_R;
        p.x = cup.x + ux * target; p.z = cup.z + uz * target;
        this._reflect(ux / NLEN, -SLOPE / NLEN, uz / NLEN, E_WALL, events, 'cup');
      }
    } else {
      if (rr > R - BALL_R) {
        const target = R - BALL_R;
        p.x = cup.x + ux * target; p.z = cup.z + uz * target;
        this._reflect(-ux / NLEN, SLOPE / NLEN, -uz / NLEN, E_WALL, events, 'cupInner');
      }
      if (hgt < CUP.liquidH + BALL_R * 0.5) this._end('made', events, cup);
    }
  }

  _reflect(nx, ny, nz, e, events, surface) {
    const v = this.v;
    const vn = v.x * nx + v.y * ny + v.z * nz;
    if (vn >= 0) return;
    v.x -= (1 + e) * vn * nx; v.y -= (1 + e) * vn * ny; v.z -= (1 + e) * vn * nz;
    if (-vn > 0.2) events.push({ type: 'bounce', surface, speed: -vn });
  }
}

// Solve a launch velocity that lands at `target` after `T` seconds,
// correcting for drag by shooting a few times (used by the CPU).
export function solveLaunch(from, target, T) {
  const v = {
    x: (target.x - from.x) / T,
    y: (target.y - from.y + 0.5 * GRAVITY * T * T) / T,
    z: (target.z - from.z) / T,
  };
  for (let it = 0; it < 4; it++) {
    const p = { ...from }, u = { ...v };
    for (let t = 0; t < T; t += SUBSTEP) {
      u.y -= GRAVITY * SUBSTEP;
      const k = 1 - DRAG * SUBSTEP;
      u.x *= k; u.y *= k; u.z *= k;
      p.x += u.x * SUBSTEP; p.y += u.y * SUBSTEP; p.z += u.z * SUBSTEP;
    }
    v.x += (target.x - p.x) / T;
    v.y += (target.y - p.y) / T;
    v.z += (target.z - p.z) / T;
  }
  return v;
}
