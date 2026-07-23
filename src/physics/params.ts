/** Quad physical parameters — starting values from design review; tune by feel.
 *  Units: SI (kg, m, s, N, rad). World is Three.js Y-up. */
export interface QuadParams {
  mass: number;            // kg
  inertia: [number, number, number]; // kg·m² diag [Ix, Iy, Iz] (body: X right, Y up, Z back)
  maxThrust: number;       // N total collective at throttle 1.0
  motorTau: number;        // s — first-order lag on collective thrust
  rateTauRP: number;       // s — first-order lag on roll/pitch rate command
  rateTauYaw: number;      // s — first-order lag on yaw rate command
  dragLin: number;         // N·s/m
  dragQuad: number;        // N·s²/m²
  dragAng: number;         // N·m·s/rad — angular damping
  g: number;               // m/s²
  groundY: number;         // m — ground plane height
  crashSpeed: number;      // m/s — ground impact speed that counts as a crash
  respawnDelay: number;    // s — auto-respawn after crash
  size: number;            // m — collision radius (approx. prop-to-prop half-diagonal)
}

export const DEFAULT_PARAMS: QuadParams = {
  mass: 0.65,
  inertia: [0.004, 0.008, 0.004],
  maxThrust: 26,           // T/W ≈ 4.1 → hover ≈ 25% throttle (1/TW)
  motorTau: 0.04,
  rateTauRP: 0.02,
  rateTauYaw: 0.03,
  dragLin: 0.15,
  dragQuad: 0.012,         // top speed ≈ 30 m/s in level flight
  dragAng: 0.005,
  g: 9.81,
  groundY: 0,
  crashSpeed: 8,
  respawnDelay: 1.0,
  size: 0.12,
};
