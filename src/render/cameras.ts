/** Camera rig: FPV (primary) + chase, one shared PerspectiveCamera.
 *
 *  FPV: parented to the drone's interpolated visual group with a configurable
 *  uptilt — like a real FPV cam, higher tilt = faster forward-flight feel.
 *  Chase: world-space critically-damped 2nd-order spring (NOT a plain lerp — a
 *  lerp lags permanently at constant velocity; a spring catches up). Follows the
 *  drone's yaw only (chase cams shouldn't roll with the quad). */
import * as THREE from 'three';
import type { CameraMode } from '../state';

const CHASE_DIST = 4.2;   // m behind
const CHASE_UP = 1.6;     // m above
const LOOK_OMEGA = 25;    // rad/s — look-at smoothing (1st order is fine here)
const CHASE_FOV = 75;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'fpv';
  private fpvFov: number;
  private uptiltRad: number;
  private drone: THREE.Object3D;
  private scene: THREE.Scene;
  private stiffness: number; // chase spring ω, rad/s

  // chase spring state
  private camPos = new THREE.Vector3();
  private camVel = new THREE.Vector3();
  private lookPos = new THREE.Vector3();
  private initialized = false;

  constructor(scene: THREE.Scene, drone: THREE.Object3D, opts: { fovDeg: number; uptiltDeg: number; stiffness: number }) {
    this.scene = scene;
    this.drone = drone;
    this.fpvFov = opts.fovDeg;
    this.uptiltRad = (opts.uptiltDeg * Math.PI) / 180;
    this.stiffness = opts.stiffness;
    this.camera = new THREE.PerspectiveCamera(opts.fovDeg, innerWidth / innerHeight, 0.05, 3000);
    this.applyMode();
  }

  setMode(m: CameraMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.initialized = false; // re-seed the spring so switching doesn't whip
    this.applyMode();
  }

  getMode(): CameraMode {
    return this.mode;
  }

  toggle(): CameraMode {
    this.setMode(this.mode === 'fpv' ? 'chase' : 'fpv');
    return this.mode;
  }

  setUptilt(deg: number): void {
    this.uptiltRad = (deg * Math.PI) / 180;
    if (this.mode === 'fpv') this.camera.rotation.set(this.uptiltRad, 0, 0);
  }

  setFov(deg: number): void {
    this.fpvFov = deg;
    if (this.mode === 'fpv') {
      this.camera.fov = deg;
      this.camera.updateProjectionMatrix();
    }
  }

  setStiffness(omega: number): void {
    this.stiffness = omega;
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private applyMode(): void {
    if (this.mode === 'fpv') {
      this.drone.add(this.camera);
      this.camera.position.set(0, 0.03, -0.08); // at the nose
      this.camera.rotation.set(this.uptiltRad, 0, 0);
      this.camera.fov = this.fpvFov;
      // Don't render our own props/arms in front of the lens. The camera stays a
      // child of the (invisible) group — matrices still update.
      this.drone.visible = false;
    } else {
      this.scene.add(this.camera);
      this.camera.rotation.set(0, 0, 0);
      this.camera.fov = CHASE_FOV;
      this.drone.visible = true;
    }
    this.camera.updateProjectionMatrix();
  }

  private _fwd = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _acc = new THREE.Vector3();

  /** Call once per render frame with the interpolated drone transform in place. */
  update(dt: number): void {
    if (this.mode !== 'chase') return;

    // Horizontal heading only: project drone forward (−Z) onto the ground plane.
    this._fwd.set(0, 0, -1).applyQuaternion(this.drone.quaternion);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-6) this._fwd.set(0, 0, -1); // looking straight down — keep last
    this._fwd.normalize();

    this._target.copy(this.drone.position).addScaledVector(this._fwd, -CHASE_DIST);
    this._target.y = this.drone.position.y + CHASE_UP;

    if (!this.initialized) {
      this.camPos.copy(this._target);
      this.camVel.set(0, 0, 0);
      this.lookPos.copy(this.drone.position);
      this.initialized = true;
    }

    // Critically damped spring: a = ω²(target−x) − 2ω·v
    const w = this.stiffness;
    this._acc.copy(this._target).sub(this.camPos).multiplyScalar(w * w);
    this._acc.addScaledVector(this.camVel, -2 * w);
    this.camVel.addScaledVector(this._acc, dt);
    this.camPos.addScaledVector(this.camVel, dt);

    // Look-at point: 1st-order smoothed drone position (higher ω keeps it centered).
    const kLook = 1 - Math.exp(-LOOK_OMEGA * dt);
    this.lookPos.lerp(this.drone.position, kLook);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookPos);
  }
}
