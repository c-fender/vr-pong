// Real-world dimensions in meters.
export const TABLE = { length: 2.44, width: 0.61, height: 0.76, thickness: 0.03 };

// 16oz party cup.
export const CUP = {
  topR: 0.0475,
  bottomR: 0.03,
  height: 0.12,
  rimR: 0.0035,
  liquidH: 0.065,
};

export const BALL_R = 0.02;
export const GRAVITY = 9.81;

// Where the player stands (flat mode camera / VR rig origin).
export const PLAYER_Z = TABLE.length / 2 + 0.42;
export const EYE_HEIGHT = 1.42;
