// Run: node tests/physics.test.mjs
// Sanity-checks the physics + throw tuning without a browser.
import { BallSim, solveLaunch } from '../src/physics.js';
import { formationPositions } from '../src/rack.js';
import { TABLE, CUP, PLAYER_Z, LAUNCH_HEIGHT } from '../src/constants.js';
import { swipeToVelocity } from '../src/throw.js';

const cups = () => formationPositions(10, 'far').map((p, i) => ({ ...p, id: i, active: true }));

function shoot(p, v, cs) {
  const sim = new BallSim();
  sim.launch(p, v);
  for (let i = 0; i < 60 * 8 && sim.active; i++) sim.step(1 / 60, cs);
  return sim;
}

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

// 1. Swipe speed sweep from the player's hand position.
const hand = { x: 0, y: LAUNCH_HEIGHT, z: PLAYER_Z - 0.42 };
const sweep = [];
for (let s = 0.5; s <= 5.01; s += 0.1) {
  const sim = shoot(hand, swipeToVelocity(s, 0, 0, 1), cups());
  sweep.push(`${s.toFixed(1)}:${sim.result === 'made' ? 'M' : '.'}`);
}
console.log('swipe sweep (screen-heights/s : made?)\n ', sweep.join(' '));
check(sweep.some((x) => x.endsWith('M')), 'some swipe speed sinks a cup');

// 2. Dropping a ball straight into a cup counts as made.
{
  const cs = cups();
  const sim = shoot({ x: cs[0].x, y: TABLE.height + 0.4, z: cs[0].z }, { x: 0, y: 0, z: 0 }, cs);
  check(sim.result === 'made' && sim.sunkCup === cs[0], 'vertical drop into cup is made');
}

// 3. Ball dropped on a rim edge doesn't fall through.
{
  const cs = cups();
  const sim = shoot({ x: cs[0].x + CUP.topR + 0.012, y: TABLE.height + 0.4, z: cs[0].z }, { x: 0, y: 0, z: 0 }, cs);
  check(sim.result != null, `rim drop resolves (${sim.result})`);
}

// 4. CPU accuracy per difficulty.
for (const [name, sigma] of Object.entries({ easy: 0.12, medium: 0.07, hard: 0.03 })) {
  let made = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const cs = formationPositions(10, 'near').map((p) => ({ ...p, active: true }));
    const target = cs[Math.floor(Math.random() * cs.length)];
    const from = { x: 0, y: 1.3, z: -TABLE.length / 2 - 0.35 };
    const v = solveLaunch(from, { x: target.x, y: TABLE.height + CUP.height + 0.01, z: target.z }, 0.85);
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2 * sigma;
    const sim = shoot(from, { x: v.x + g(), y: v.y + g(), z: v.z + g() }, cs);
    if (sim.result === 'made') made++;
  }
  console.log(`     cpu ${name}: ${(100 * made / N).toFixed(0)}% hit`);
}

process.exit(failures ? 1 : 0);
