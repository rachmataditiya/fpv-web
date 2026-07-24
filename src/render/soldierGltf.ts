/** Kenney rigged soldier (mini-arena character-soldier.glb) as a drop-in
 *  SoldierMesh: same { group, setPose(walkPhase, aimPitch), setDown(t) }
 *  contract as the procedural soldier.
 *
 *  The pack's animation clips mix two rig conventions (the 'walk' family
 *  carries a −90° root the model doesn't want — soldiers played it lying on
 *  their backs), so we DON'T use an AnimationMixer at all. The rig has six
 *  named bones (root / leg-left / leg-right / torso / arm-left / arm-right /
 *  head) and we puppet them directly, exactly like the procedural soldier's
 *  pivots: legs swing by sin(walkPhase), arms counter-swing, torso pitches to
 *  the aim, rifle rides the right arm. Deterministic-looking, zero clip
 *  surprises, zero per-frame allocations.
 *
 *  Template preloads once (initSoldierTemplate at boot); instances are SYNC
 *  SkeletonUtils clones so BotManager's constructor stays synchronous. Not
 *  ready / 404 → createSoldierInstance returns null → procedural fallback. */
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGltf } from './modelLoader';
import { SOLDIER_HEIGHT } from './soldierMesh';
import type { SoldierMesh } from './soldierMesh';

const SOLDIER_URL = '/assets/models/arena/soldier.glb';
const HAND_WEAPON_URL = '/assets/models/blaster/weapon-hand.glb';

let template: THREE.Group | null = null;
let weaponTemplate: THREE.Object3D | null = null;

/** Kick off the load early (main.ts boot) so instances are ready by the time
 *  the BSP world constructs its bots. */
export async function initSoldierTemplate(): Promise<void> {
  const [gltf, weapon] = await Promise.all([loadGltf(SOLDIER_URL), loadGltf(HAND_WEAPON_URL)]);
  if (gltf) template = gltf.scene as THREE.Group;
  if (weapon) weaponTemplate = weapon.scene;
}

export function soldierTemplateReady(): boolean {
  return template !== null;
}

/** SYNC instance from the preloaded template (null = fall back to procedural). */
export function createSoldierInstance(): SoldierMesh | null {
  if (!template) return null;
  const root = skeletonClone(template);

  // normalize: feet at y=0, height = SOLDIER_HEIGHT, face −Z like everything
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = size.y > 1e-6 ? SOLDIER_HEIGHT / size.y : 1;
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.set(
    -(center.x - root.position.x) * s,
    -(box.min.y - root.position.y) * s,
    -(center.z - root.position.z) * s,
  );
  root.scale.setScalar(s);
  const inner = new THREE.Group();
  inner.add(root);
  inner.rotation.y = Math.PI; // Kenney characters face +Z; our forward is −Z
  const group = new THREE.Group();
  group.add(inner);

  // grab the puppet bones by name
  let legL: THREE.Object3D | null = null;
  let legR: THREE.Object3D | null = null;
  let armL: THREE.Object3D | null = null;
  let armR: THREE.Object3D | null = null;
  let torso: THREE.Object3D | null = null;
  root.traverse((n) => {
    if (n.name === 'leg-left') legL = n;
    else if (n.name === 'leg-right') legR = n;
    else if (n.name === 'arm-left') armL = n;
    else if (n.name === 'arm-right') armR = n;
    else if (n.name === 'torso') torso = n;
  });

  // rifle: parented to the right arm, pointed forward; the arm is raised into
  // a carry pose below, so the gun sits across the chest
  if (armR && weaponTemplate) {
    const w = weaponTemplate.clone(true);
    const wb = new THREE.Box3().setFromObject(w);
    const ws = new THREE.Vector3();
    wb.getSize(ws);
    const wLen = Math.max(ws.x, ws.z);
    // comically big rifle — matches Kenney chibi proportions and reads at range
    const wScale = wLen > 1e-6 ? 0.95 / (s * wLen) : 1;
    w.scale.setScalar(wScale);
    const wc = new THREE.Vector3();
    wb.getCenter(wc);
    w.position.set(-wc.x * wScale, -0.18 / s, -wc.z * wScale - 0.1 / s);
    (armR as THREE.Object3D).add(w);
  }

  // NOTE on signs: the Kenney character faces +Z in MODEL space (we yaw the
  // wrapper by PI), so pitch senses are mirrored vs the procedural soldier.
  let dying = false;

  const setPose = (walkPhase: number, aimPitchRad: number): void => {
    if (dying) return; // setDown owns the pose once death starts
    const swing = Math.sin(walkPhase) * 0.55;
    if (legL) (legL as THREE.Object3D).rotation.x = swing;
    if (legR) (legR as THREE.Object3D).rotation.x = -swing;
    // left arm counter-swings; right arm stays raised carrying the rifle
    // (bone frames verified empirically: −X = swing forward on this rig)
    if (armL) (armL as THREE.Object3D).rotation.x = -swing * 0.5;
    if (armR) (armR as THREE.Object3D).rotation.x = -1.15 + swing * 0.08;
    const aim = Math.max(-1, Math.min(1, aimPitchRad));
    // + aim = target above → +X torso pitch on this rig
    if (torso) (torso as THREE.Object3D).rotation.x = aim * 0.6;
  };

  const setDown = (t: number): void => {
    dying = true;
    // crumple: torso folds forward, whole body sinks — killcam corpses only;
    // live deaths are handled by the ragdoll pool
    const k = Math.min(1, t);
    if (torso) (torso as THREE.Object3D).rotation.x = k * 1.3;
    group.position.y = -k * 0.55;
    group.rotation.x = -k * 0.35;
  };

  return { group, setPose, setDown };
}
