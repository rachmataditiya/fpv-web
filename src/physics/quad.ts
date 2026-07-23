/** Acro/rate-mode quad flight model — hand-rolled rigid body, stepped at a fixed
 *  dt (1/240 s). Deliberately NOT a general physics engine: one dynamic body, one
 *  ground plane, everything else in the world is a trigger test (see world/track.ts).
 *
 *  Frames: world is Three.js Y-up. Body: +X right, +Y up (thrust axis), −Z forward
 *  (matches Three.js object/camera convention so the FPV camera needs no extra basis
 *  change). With that basis, right-hand-rule signs work out to:
 *    nose-down (pitch fwd, stick +) → rotation about −X → ωx = −pitchRate
 *    nose-right (yaw right, stick +) → rotation about −Y → ωy = −yawRate
 *    right-wing-down (roll right, stick +) → rotation about −Z → ωz = −rollRate
 */
import * as THREE from 'three';
import type { FlightInput } from '../input/types';
import type { QuadParams } from './params';

/** Optional world collision provider. Without one, the world is the infinite
 *  flat plane at params.groundY. Terrain maps supply floorAt; BSP maps supply
 *  both floorAt and sweep (walls/ceilings). */
export interface CollisionWorld {
  /** Ground height under (x,y,z); null = off the map (fall forever). */
  floorAt(x: number, y: number, z: number): number | null;
  /** First surface hit along the segment from→to, or null. */
  sweep?(from: THREE.Vector3, to: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3 } | null;
}

export interface QuadState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;          // world m/s
  q: THREE.Quaternion;         // body → world
  omega: THREE.Vector3;        // body rad/s (lagged actual rates)
  thrust: number;              // lagged collective 0..1
  armed: boolean;
  crashed: boolean;
  crashTimer: number;          // s until auto-respawn while crashed
  groundSpeedAtImpact: number; // for HUD/debug of the last touch
}

export function createQuadState(): QuadState {
  return {
    pos: new THREE.Vector3(0, 1, 0),
    vel: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    omega: new THREE.Vector3(),
    thrust: 0,
    armed: false,
    crashed: false,
    crashTimer: 0,
    groundSpeedAtImpact: 0,
  };
}

/** Place the quad at a checkpoint: level attitude, given heading, at rest. */
export function resetQuad(s: QuadState, pos: THREE.Vector3, yawDeg: number, hoverAltitude = 0): void {
  s.pos.copy(pos);
  s.pos.y += hoverAltitude;
  s.vel.set(0, 0, 0);
  s.q.setFromAxisAngle(_Y, (yawDeg * Math.PI) / 180);
  s.omega.set(0, 0, 0);
  s.thrust = 0;
  s.crashed = false;
  s.crashTimer = 0;
}

const _Y = new THREE.Vector3(0, 1, 0);
const _up = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const _segStart = new THREE.Vector3();

/** One fixed physics step. Returns true if this step ended in a new crash. */
export function stepQuad(s: QuadState, input: FlightInput, p: QuadParams, dt: number, world?: CollisionWorld): boolean {
  if (s.crashed) {
    s.crashTimer -= dt;
    return false; // frozen where it fell until respawn
  }

  // --- rate command with first-order lag (rate controller + motor response in one) ---
  // Signs per the frame note above; disarmed = rates decay to zero.
  const tgtX = s.armed ? -input.pitchRate : 0;
  const tgtY = s.armed ? -input.yawRate : 0;
  const tgtZ = s.armed ? -input.rollRate : 0;
  const kRP = Math.min(1, dt / p.rateTauRP);
  const kYaw = Math.min(1, dt / p.rateTauYaw);
  s.omega.x += (tgtX - s.omega.x) * kRP;
  s.omega.y += (tgtY - s.omega.y) * kYaw;
  s.omega.z += (tgtZ - s.omega.z) * kRP;

  // --- attitude: q ← q ⊗ exp(½ ω_body dt), then renormalize ---
  const w = s.omega.length();
  if (w > 1e-9) {
    _axis.copy(s.omega).multiplyScalar(1 / w);
    _dq.setFromAxisAngle(_axis, w * dt);
    s.q.multiply(_dq).normalize();
  }

  // --- collective thrust with motor lag; disarmed = motors off ---
  const tgtThr = s.armed ? Math.max(0, Math.min(1, input.throttle)) : 0;
  s.thrust += (tgtThr - s.thrust) * Math.min(1, dt / p.motorTau);

  // --- forces: thrust along body +Y, gravity, |v|-dependent drag ---
  _up.set(0, 1, 0).applyQuaternion(s.q);
  _acc.copy(_up).multiplyScalar((s.thrust * p.maxThrust) / p.mass);
  _acc.y -= p.g;
  const speed = s.vel.length();
  if (speed > 1e-6) {
    const dragF = p.dragLin + p.dragQuad * speed; // N per (m/s)
    _acc.addScaledVector(s.vel, -dragF / p.mass);
  }

  // --- semi-implicit Euler ---
  _prev.copy(s.pos);
  s.vel.addScaledVector(_acc, dt);
  s.pos.addScaledVector(s.vel, dt);

  // --- wall/floor/ceiling sweep (BSP worlds): segment cast along this step's
  // motion. ALWAYS active — a disarmed quad falls at up to ~30 m/s (12+ cm per
  // 240 Hz step), which tunnels straight through floorAt's small ray margin, so
  // the sweep is what keeps a falling drone on top of map geometry. Arming only
  // decides whether a hard hit counts as a crash.
  //
  // ITERATIVE + EXTENDED: a single point-cast per tick tunnels in two ways —
  // (1) corner push-out can land inside the adjacent brush, so the next tick's
  // segment starts INSIDE solid and DoubleSide finds the exit face first;
  // (2) a segment that starts exactly on a touched wall can slide through at
  // grazing angles. So: start the cast one drone-radius BEHIND the motion, pin
  // the normal against the motion direction (not the velocity, which earlier
  // iterations may have altered), and resolve up to 3 hits per tick. ---
  if (world?.sweep) {
    for (let iter = 0; iter < 3; iter++) {
      _d.subVectors(s.pos, _prev);
      const seg = _d.length();
      if (seg < 1e-9) break;
      _d.multiplyScalar(1 / seg);
      _segStart.copy(_prev).addScaledVector(_d, -p.size);
      const hit = world.sweep(_segStart, s.pos);
      if (!hit) break;
      _n.copy(hit.normal);
      if (_n.dot(_d) > 0) _n.negate(); // face against the motion
      const impact = -s.vel.dot(_n);
      if (impact > p.crashSpeed && s.armed) {
        s.pos.copy(hit.point).addScaledVector(_n, p.size);
        s.crashed = true;
        s.crashTimer = p.respawnDelay;
        s.vel.set(0, 0, 0);
        s.omega.set(0, 0, 0);
        s.thrust = 0;
        s.groundSpeedAtImpact = impact;
        return true;
      }
      // glancing hit (or any disarmed hit): push out, kill the normal
      // component, damp the rest — dead drones settle instead of clipping.
      s.pos.copy(hit.point).addScaledVector(_n, p.size * 1.05);
      if (impact > 0) s.vel.addScaledVector(_n, impact * (s.armed ? 1.25 : 1.05));
      s.vel.multiplyScalar(s.armed ? 0.9 : 0.6);
      _prev.copy(hit.point).addScaledVector(_n, p.size * 1.05); // re-check from the corrected point
    }
  }

  // --- ground ---
  const floorY = world ? world.floorAt(s.pos.x, s.pos.y, s.pos.z) : p.groundY;
  if (floorY === null) return false; // off the map — keep falling (OOB handles it)
  const floor = floorY + p.size;
  if (s.pos.y < floor) {
    const impact = Math.abs(s.vel.y);
    s.groundSpeedAtImpact = impact;
    s.pos.y = floor;
    if (s.armed && impact > p.crashSpeed) {
      s.crashed = true;
      s.crashTimer = p.respawnDelay;
      s.vel.set(0, 0, 0);
      s.omega.set(0, 0, 0);
      s.thrust = 0;
      return true;
    }
    // soft touch: damped bounce + ground friction
    s.vel.y = impact * 0.25;
    s.vel.x *= 0.7;
    s.vel.z *= 0.7;
    if (!s.armed && impact < 0.5) s.vel.set(0, 0, 0); // settle when dead
  }
  return false;
}
