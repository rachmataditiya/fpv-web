/** Soldier state machine + ground steering. Pure: mutates the Bot, pushes
 *  events, all world access via SoldierEnv, all randomness via bot.rng.
 *
 *  patrol → (sees/hears player) → alert (turn + reaction delay) → engage
 *  (slew-limited facing, burst fire, strafe) → seek last-known on LOS loss →
 *  patrol. Movement snaps Y to the floor and refuses steps > maxStepUp so
 *  soldiers never walk off ledges or up walls. */
import * as THREE from 'three';
import type { CollisionWorld } from '../../physics/quad';
import { canSee, hearsNoise } from './perception';
import { resolveBotShot } from './botFire';
import { PLAYER_TARGET_RADIUS, TUNING } from './types';
import type { Bot, BotCtx, BotEvent } from './types';

export interface SoldierEnv {
  world: CollisionWorld;
  /** Strict floor sampler for movement (null = off-map / no floor). */
  floorAt(x: number, z: number): number | null;
  /** Fresh patrol waypoint on valid geometry (manager-seeded sampling). */
  sampleWaypoint(): { x: number; y: number; z: number } | null;
}

const S = TUNING.soldier;

const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

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

function setState(b: Bot, s: Bot['state']): void {
  b.state = s;
  b.stateTime = 0;
}

/** Walk toward (tx, tz); returns false when blocked by a ledge/step/off-map. */
function moveGround(b: Bot, tx: number, tz: number, speed: number, dt: number, env: SoldierEnv): boolean {
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

export function stepSoldier(b: Bot, ctx: BotCtx, env: SoldierEnv, dt: number, events: BotEvent[]): void {
  b.stateTime += dt;
  if (b.fireCooldown > 0) b.fireCooldown -= dt;
  b.vel.set(0, 0, 0); // stands unless a move succeeds this tick

  const feetY = b.pos.y - S.height / 2;
  _eye.set(b.pos.x, feetY + S.eyeHeight, b.pos.z);
  const seesPlayer =
    ctx.playerAlive && canSee(_eye, b.yaw, ctx.playerPos, S.visionRange, S.fovRad, env.world);
  if (seesPlayer) {
    b.lastKnown = (b.lastKnown ?? new THREE.Vector3()).copy(ctx.playerPos);
    b.trackTime += dt;
  } else {
    b.trackTime = 0;
  }
  const hears =
    ctx.playerAlive && ctx.playerNoise && hearsNoise(b.pos, ctx.playerPos, S.hearRange);
  if (hears) b.lastKnown = (b.lastKnown ?? new THREE.Vector3()).copy(ctx.playerPos);

  switch (b.state) {
    case 'patrol': {
      if (seesPlayer || hears) {
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
      if (seesPlayer) {
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
      if (!seesPlayer) {
        if (b.stateTime > S.losLossToSeekS) setState(b, 'seek');
        break;
      }
      b.stateTime = 0; // stateTime counts continuous LOS loss while engaging
      const targetYaw = yawToward(ctx.playerPos.x - b.pos.x, ctx.playerPos.z - b.pos.z);
      b.yaw = slewYaw(b.yaw, targetYaw, S.yawSlewRad, dt);

      // short strafes, flipping every strafeFlipS; ledge-checked like patrol
      const strafeSign = Math.floor(b.trackTime / S.strafeFlipS) % 2 === 0 ? 1 : -1;
      const fx = -Math.sin(b.yaw);
      const fz = -Math.cos(b.yaw);
      moveGround(b, b.pos.x - fz * strafeSign * 2, b.pos.z + fx * strafeSign * 2, S.strafeSpeed, dt, env);

      // fire when roughly on target (yaw slew makes flanking beat the turn rate)
      let yawErr = (targetYaw - b.yaw) % (Math.PI * 2);
      if (yawErr > Math.PI) yawErr -= Math.PI * 2;
      if (yawErr < -Math.PI) yawErr += Math.PI * 2;
      if (Math.abs(yawErr) < S.fireConeRad && b.fireCooldown <= 0) {
        _muzzle.set(b.pos.x, feetY + S.muzzleHeight, b.pos.z);
        const shot = resolveBotShot(
          _muzzle, ctx.playerPos, ctx.playerVel.length(), PLAYER_TARGET_RADIUS,
          b.trackTime, env.world, b.rng, S,
        );
        events.push({ type: 'bot-shot', from: _muzzle.clone(), to: shot.to, hitPlayer: shot.hitPlayer, damage: S.damage });
        b.burstLeft--;
        if (b.burstLeft <= 0) {
          b.burstLeft = S.burstCount;
          b.fireCooldown = S.burstPauseS;
        } else {
          b.fireCooldown = S.burstInterval;
        }
      }
      break;
    }

    case 'seek': {
      if (seesPlayer) {
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
