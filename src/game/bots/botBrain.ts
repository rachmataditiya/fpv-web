/** Bot state machines. Pure: mutate the Bot, push events, all world access
 *  via BotEnv, all randomness via bot.rng.
 *
 *  Both kinds share the same skeleton:
 *  patrol → (sees / hears player) → alert (turn + reaction delay) → engage
 *  (slew-limited facing, burst fire) → seek last-known on LOS loss → patrol.
 *
 *  Hearing has two rings: player shots carry to hearRange, and the player's
 *  rotor noise carries to rotorHearRange every tick — hovering next to a bot
 *  gets you noticed even if you never fire and it never looks your way.
 *
 *  Soldiers walk: floor-snapped, refusing steps > maxStepUp (no ledge dives).
 *  Drones fly: accel-clamped kinematic steering inside an altitude band above
 *  the local floor, sweep push-out against walls (raw motion segment only —
 *  never extend it backward, see the fall-through-spawn fix). */
import * as THREE from 'three';
import type { CollisionWorld } from '../../physics/quad';
import { canSee, hearsNoise } from './perception';
import { resolveBotShot } from './botFire';
import { PLAYER_TARGET_RADIUS, TUNING } from './types';
import type { Bot, BotCtx, BotEvent } from './types';

export interface BotEnv {
  world: CollisionWorld;
  /** Strict floor sampler for movement (null = off-map / no floor). */
  floorAt(x: number, z: number): number | null;
  /** Fresh patrol waypoint on valid geometry (manager-seeded sampling). */
  sampleWaypoint(): { x: number; y: number; z: number } | null;
}
/** Back-compat alias (soldier tests / older imports). */
export type SoldierEnv = BotEnv;

const S = TUNING.soldier;
const D = TUNING.drone;

const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _next = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Yaw whose facing vector (−sin yaw, −cos yaw) points along (dx, dz). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Slew yaw toward target by at most rate·dt, along the short way around. */
export function slewYaw(yaw: number, target: number, rate: number, dt: number): number {
  let d = (target - yaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const step = rate * dt;
  return yaw + Math.max(-step, Math.min(step, d));
}

function yawErrTo(yaw: number, target: number): number {
  let d = (target - yaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function setState(b: Bot, s: Bot['state']): void {
  b.state = s;
  b.stateTime = 0;
}

function updateSenses(
  b: Bot,
  ctx: BotCtx,
  env: BotEnv,
  dt: number,
  eyeY: number,
  k: { visionRange: number; fovRad: number; hearRange: number; rotorHearRange: number },
): { sees: boolean; hears: boolean } {
  _eye.set(b.pos.x, eyeY, b.pos.z);
  const sees =
    ctx.playerAlive && canSee(_eye, b.yaw, ctx.playerPos, k.visionRange, k.fovRad, env.world);
  if (sees) {
    b.lastKnown = (b.lastKnown ?? new THREE.Vector3()).copy(ctx.playerPos);
    b.trackTime += dt;
  } else {
    b.trackTime = 0;
  }
  const hears =
    ctx.playerAlive &&
    ((ctx.playerNoise && hearsNoise(b.pos, ctx.playerPos, k.hearRange)) ||
      hearsNoise(b.pos, ctx.playerPos, k.rotorHearRange));
  if (hears) b.lastKnown = (b.lastKnown ?? new THREE.Vector3()).copy(ctx.playerPos);
  return { sees, hears };
}

function fireAt(
  b: Bot,
  ctx: BotCtx,
  env: BotEnv,
  muzzleY: number,
  k: typeof S | typeof D,
  events: BotEvent[],
): void {
  const targetYaw = yawToward(ctx.playerPos.x - b.pos.x, ctx.playerPos.z - b.pos.z);
  if (Math.abs(yawErrTo(b.yaw, targetYaw)) >= k.fireConeRad || b.fireCooldown > 0) return;
  _muzzle.set(b.pos.x, muzzleY, b.pos.z);
  const shot = resolveBotShot(
    _muzzle, ctx.playerPos, ctx.playerVel.length(), PLAYER_TARGET_RADIUS,
    b.trackTime, env.world, b.rng, k,
  );
  events.push({ type: 'bot-shot', from: _muzzle.clone(), to: shot.to, hitPlayer: shot.hitPlayer, damage: k.damage });
  b.burstLeft--;
  if (b.burstLeft <= 0) {
    b.burstLeft = k.burstCount;
    b.fireCooldown = k.burstPauseS;
  } else {
    b.fireCooldown = k.burstInterval;
  }
}

// ---------------------------------------------------------------- soldier ---

/** Walk toward (tx, tz); returns false when blocked by a ledge/step/off-map. */
function moveGround(b: Bot, tx: number, tz: number, speed: number, dt: number, env: BotEnv): boolean {
  const dx = tx - b.pos.x;
  const dz = tz - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return true;
  const step = Math.min(speed * dt, d);
  const nx = b.pos.x + (dx / d) * step;
  const nz = b.pos.z + (dz / d) * step;
  const curFloor = b.pos.y - S.height / 2;
  const floor = env.floorAt(nx, nz);
  if (floor === null || Math.abs(floor - curFloor) > S.maxStepUp) return false;
  b.pos.set(nx, floor + S.height / 2, nz);
  b.vel.set((dx / d) * speed, 0, (dz / d) * speed);
  return true;
}

export function stepSoldier(b: Bot, ctx: BotCtx, env: BotEnv, dt: number, events: BotEvent[]): void {
  b.stateTime += dt;
  if (b.fireCooldown > 0) b.fireCooldown -= dt;
  b.vel.set(0, 0, 0); // stands unless a move succeeds this tick

  const feetY = b.pos.y - S.height / 2;
  const { sees, hears } = updateSenses(b, ctx, env, dt, feetY + S.eyeHeight, S);

  switch (b.state) {
    case 'patrol': {
      if (sees || hears) {
        setState(b, 'alert');
        b.reactionLeft = S.reactionS;
        break;
      }
      if (!b.waypoint) {
        const w = env.sampleWaypoint();
        if (w) b.waypoint = new THREE.Vector3(w.x, w.y, w.z);
        break; // no waypoint this tick — stand
      }
      b.yaw = slewYaw(b.yaw, yawToward(b.waypoint.x - b.pos.x, b.waypoint.z - b.pos.z), S.yawSlewRad, dt);
      const arrived = Math.hypot(b.waypoint.x - b.pos.x, b.waypoint.z - b.pos.z) < 1;
      if (arrived || !moveGround(b, b.waypoint.x, b.waypoint.z, S.patrolSpeed, dt, env)) {
        b.waypoint = null; // arrived or blocked → pick a new one next tick
      }
      break;
    }

    case 'alert': {
      // turn toward the stimulus while the reaction timer runs
      if (b.lastKnown) {
        b.yaw = slewYaw(b.yaw, yawToward(b.lastKnown.x - b.pos.x, b.lastKnown.z - b.pos.z), S.yawSlewRad, dt);
      }
      if (sees) {
        b.reactionLeft -= dt;
        if (b.reactionLeft <= 0) {
          setState(b, 'engage');
          b.burstLeft = S.burstCount;
          b.fireCooldown = 0;
        }
      } else if (hears) {
        b.stateTime = 0; // fresh stimulus keeps us alert
      } else if (b.stateTime > S.alertStaleS) {
        setState(b, 'patrol');
      }
      break;
    }

    case 'engage': {
      if (!sees) {
        if (b.stateTime > S.losLossToSeekS) setState(b, 'seek');
        break;
      }
      b.stateTime = 0; // stateTime counts continuous LOS loss while engaging
      b.yaw = slewYaw(b.yaw, yawToward(ctx.playerPos.x - b.pos.x, ctx.playerPos.z - b.pos.z), S.yawSlewRad, dt);

      // short strafes, flipping every strafeFlipS; ledge-checked like patrol
      const strafeSign = Math.floor(b.trackTime / S.strafeFlipS) % 2 === 0 ? 1 : -1;
      const fx = -Math.sin(b.yaw);
      const fz = -Math.cos(b.yaw);
      moveGround(b, b.pos.x - fz * strafeSign * 2, b.pos.z + fx * strafeSign * 2, S.strafeSpeed, dt, env);

      fireAt(b, ctx, env, feetY + S.muzzleHeight, S, events);
      break;
    }

    case 'seek': {
      if (sees) {
        setState(b, 'engage');
        b.burstLeft = S.burstCount;
        b.fireCooldown = 0;
        break;
      }
      const lk = b.lastKnown;
      if (!lk || b.stateTime > S.seekTimeoutS) {
        setState(b, 'patrol');
        break;
      }
      b.yaw = slewYaw(b.yaw, yawToward(lk.x - b.pos.x, lk.z - b.pos.z), S.yawSlewRad, dt);
      const arrived = Math.hypot(lk.x - b.pos.x, lk.z - b.pos.z) < 1.5;
      if (arrived || !moveGround(b, lk.x, lk.z, S.patrolSpeed, dt, env)) {
        setState(b, 'patrol');
        b.lastKnown = null;
      }
      break;
    }

    case 'dead':
      break;
  }
}

// ------------------------------------------------------------------ drone ---

/** Accel-clamped kinematic flight toward a point with sweep push-out against
 *  walls. The altitude band above the local floor is enforced by STEERING the
 *  vertical velocity (which then goes through the sweep like any other motion)
 *  — never by clamping the position: a position clamp at a roof edge teleports
 *  the drone through geometry and wedges it inside forever. */
function moveAir(b: Bot, tx: number, ty: number, tz: number, speed: number, dt: number, env: BotEnv): void {
  _desired.set(tx - b.pos.x, ty - b.pos.y, tz - b.pos.z);
  const d = _desired.length();
  if (d > 1e-6) _desired.multiplyScalar(Math.min(speed, d / Math.max(dt, 1e-6)) / d);
  else _desired.set(0, 0, 0);
  // altitude-band steering relative to the floor under us right now
  const floorHere = env.floorAt(b.pos.x, b.pos.z);
  if (floorHere !== null) {
    const agl = b.pos.y - floorHere;
    if (agl < D.altMin) _desired.y = Math.max(_desired.y, D.climbSpeed);
    else if (agl > D.altMax) _desired.y = Math.min(_desired.y, -D.climbSpeed);
  }
  _dv.subVectors(_desired, b.vel);
  const dv = _dv.length();
  const maxDv = D.accel * dt;
  if (dv > maxDv) _dv.multiplyScalar(maxDv / dv);
  b.vel.add(_dv);

  _next.copy(b.pos).addScaledVector(b.vel, dt);
  if (env.floorAt(_next.x, _next.z) === null) {
    // the step would cross the map-footprint edge — hold and bleed speed
    b.vel.multiplyScalar(0.5);
    return;
  }
  const hit = env.world.sweep ? env.world.sweep(b.pos, _next) : null;
  if (hit) {
    _n.copy(hit.normal);
    if (_n.dot(b.vel) > 0) _n.negate(); // orient the normal against motion
    if (hit.point.distanceTo(b.pos) < 0.05) {
      // wedged against/inside a surface — nudge out and try again next tick
      b.pos.addScaledVector(_n, 0.5);
      return;
    }
    _next.copy(hit.point).addScaledVector(_n, 0.4);
    const into = b.vel.dot(_n);
    if (into < 0) b.vel.addScaledVector(_n, -into); // slide along the wall
  }
  b.pos.copy(_next);
}

export function stepDrone(b: Bot, ctx: BotCtx, env: BotEnv, dt: number, events: BotEvent[]): void {
  b.stateTime += dt;
  if (b.fireCooldown > 0) b.fireCooldown -= dt;

  const { sees, hears } = updateSenses(b, ctx, env, dt, b.pos.y, D);

  switch (b.state) {
    case 'patrol': {
      if (sees || hears) {
        setState(b, 'alert');
        b.reactionLeft = D.reactionS;
        break;
      }
      if (!b.waypoint) {
        const w = env.sampleWaypoint();
        if (w) {
          b.waypoint = new THREE.Vector3(w.x, w.y + (D.altMin + D.altMax) / 2, w.z);
          b.wpTime = 0;
        }
        moveAir(b, b.pos.x, b.pos.y, b.pos.z, 0, dt, env); // hover in place
        break;
      }
      b.wpTime += dt;
      moveAir(b, b.waypoint.x, b.waypoint.y, b.waypoint.z, D.patrolSpeed, dt, env);
      if (b.vel.lengthSq() > 0.5) b.yaw = slewYaw(b.yaw, yawToward(b.vel.x, b.vel.z), D.yawSlewRad, dt);
      const arrived = Math.hypot(b.waypoint.x - b.pos.x, b.waypoint.z - b.pos.z) < 2;
      // abandon waypoints we can't make progress toward (walled off / wedged)
      const stuck = (b.wpTime > 1.5 && b.vel.lengthSq() < 0.25) || b.wpTime > 12;
      if (arrived || stuck) b.waypoint = null;
      break;
    }

    case 'alert': {
      moveAir(b, b.pos.x, b.pos.y, b.pos.z, 0, dt, env); // brake and look
      if (b.lastKnown) {
        b.yaw = slewYaw(b.yaw, yawToward(b.lastKnown.x - b.pos.x, b.lastKnown.z - b.pos.z), D.yawSlewRad, dt);
      }
      if (sees) {
        b.reactionLeft -= dt;
        if (b.reactionLeft <= 0) {
          setState(b, 'engage');
          b.burstLeft = D.burstCount;
          b.fireCooldown = 0;
        }
      } else if (hears) {
        b.stateTime = 0;
      } else if (b.stateTime > D.alertStaleS) {
        setState(b, 'patrol');
      }
      break;
    }

    case 'engage': {
      if (!sees) {
        moveAir(b, b.pos.x, b.pos.y, b.pos.z, 0, dt, env);
        if (b.stateTime > D.losLossToSeekS) setState(b, 'seek');
        break;
      }
      b.stateTime = 0;
      b.yaw = slewYaw(b.yaw, yawToward(ctx.playerPos.x - b.pos.x, ctx.playerPos.z - b.pos.z), D.yawSlewRad, dt);

      const p = ctx.playerPos;
      const dx = p.x - b.pos.x;
      const dz = p.z - b.pos.z;
      const horiz = Math.hypot(dx, dz) || 1e-6;
      if (horiz > D.engageMax) {
        moveAir(b, p.x, p.y + 2, p.z, D.pursueSpeed, dt, env); // dive in
      } else if (horiz < D.engageMin) {
        moveAir(b, b.pos.x - (dx / horiz) * 8, b.pos.y, b.pos.z - (dz / horiz) * 8, D.patrolSpeed, dt, env); // back off
      } else {
        // orbit-strafe: fly the tangent, flipping direction periodically
        const sign = Math.floor(b.trackTime / D.orbitFlipS) % 2 === 0 ? 1 : -1;
        moveAir(b, b.pos.x + (-dz / horiz) * 6 * sign, p.y + 2, b.pos.z + (dx / horiz) * 6 * sign, D.patrolSpeed, dt, env);
      }

      fireAt(b, ctx, env, b.pos.y, D, events);
      break;
    }

    case 'seek': {
      if (sees) {
        setState(b, 'engage');
        b.burstLeft = D.burstCount;
        b.fireCooldown = 0;
        break;
      }
      const lk = b.lastKnown;
      if (!lk || b.stateTime > D.seekTimeoutS) {
        setState(b, 'patrol');
        break;
      }
      moveAir(b, lk.x, lk.y + 3, lk.z, D.patrolSpeed, dt, env);
      if (b.vel.lengthSq() > 0.5) b.yaw = slewYaw(b.yaw, yawToward(b.vel.x, b.vel.z), D.yawSlewRad, dt);
      if (Math.hypot(lk.x - b.pos.x, lk.z - b.pos.z) < 3) {
        setState(b, 'patrol');
        b.lastKnown = null;
      }
      break;
    }

    case 'dead':
      break;
  }
}
