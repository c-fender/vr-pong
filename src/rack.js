import { TABLE, CUP } from './constants.js';

const ROWS = { 10: [4, 3, 2, 1], 6: [3, 2, 1], 3: [2, 1], 1: [1] };
export const RERACK_COUNTS = [6, 3, 1];

// Triangle formation of n cups for a side ('far' at -z, 'near' at +z),
// back row against the table edge, apex pointing at the center.
export function formationPositions(n, side) {
  const rows = ROWS[n];
  const sp = CUP.topR * 2 + 0.003;
  const dir = side === 'far' ? 1 : -1;
  const back = -dir * (TABLE.length / 2 - CUP.topR - 0.02);
  const out = [];
  rows.forEach((count, i) => {
    const z = back + dir * i * sp * Math.sqrt(3) / 2;
    for (let j = 0; j < count; j++) out.push({ x: (j - (count - 1) / 2) * sp, z });
  });
  return out;
}
