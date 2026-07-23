import * as THREE from 'three';

/**
 * High-fidelity procedural enemy soldier (~1.8m, desert-warfare kit).
 * - Detail via silhouette + greebles, no textures: plate carrier with mag
 *   pouches, backpack, shoulder pads, kneepads, boots with soles, helmet with
 *   brim + side rails, emissive visor, rolled sleeves (bare forearms), and a
 *   rifle with stock / barrel / magazine / foregrip / optic held two-handed.
 * - Hierarchy: legs pivot at the hips, each with a knee sub-pivot; the torso
 *   pivots at the waist and carries head, arms and rifle as ONE unit, so aim
 *   pitch drives the whole upper body toward a flying drone (+rad = aim up).
 * - setPose derives all secondary motion from walkPhase alone (knee flex on
 *   the trailing leg, torso bob/roll/yaw, arm swing, rifle counter-sway) and
 *   allocates nothing per frame — every transform is precomputed at build.
 * - Origin at the feet, forward is -Z, Y-up, 1 unit = 1 meter.
 */
export const SOLDIER_HEIGHT = 1.8;

/** Hip pivot height; the waist (torso) pivot sits just above it. */
const HIP_Y = 0.95;
const WAIST_Y = 0.98;

export interface SoldierMesh {
  group: THREE.Group;
  /** walkPhase: rad accumulator (legs swing by sin); aimPitchRad: + = aim up. */
  setPose(walkPhase: number, aimPitchRad: number): void;
}

/**
 * Build-time helper: stretch a box between two points (limb segments).
 * Allocates freely — called from the factory only, never per frame.
 */
function segment(
  from: THREE.Vector3,
  to: THREE.Vector3,
  width: number,
  depth: number,
  mat: THREE.Material,
  parent: THREE.Object3D,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, len + 0.04, depth), mat);
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(mesh);
  return mesh;
}

export function createSoldierMesh(): SoldierMesh {
  const group = new THREE.Group();

  // Shared materials (7 total) — tuned for outdoor HDRI, not flat color
  const matUniform = new THREE.MeshStandardMaterial({ color: 0x55613f, roughness: 0.9, metalness: 0.0 }); // olive drab
  const matVest = new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 0.85, metalness: 0.05 }); // coyote tan
  const matGear = new THREE.MeshStandardMaterial({ color: 0x2e3129, roughness: 0.75, metalness: 0.15 }); // dark webbing
  const matSkin = new THREE.MeshStandardMaterial({ color: 0xc9a27b, roughness: 0.75, metalness: 0.0 });
  const matBoot = new THREE.MeshStandardMaterial({ color: 0x26211b, roughness: 0.6, metalness: 0.1 });
  const matRifle = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.35, metalness: 0.75 }); // gunmetal
  const matVisor = new THREE.MeshStandardMaterial({
    color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.0, roughness: 0.25, metalness: 0.3,
  });

  // ---------------------------------------------------------------- legs ---
  // Pivot at the hip; a knee sub-pivot flexes the trailing leg while walking.
  const buildLeg = (sideX: number): { leg: THREE.Group; knee: THREE.Group } => {
    const leg = new THREE.Group();
    leg.position.set(sideX, HIP_Y, 0);
    group.add(leg);

    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.46, 0.17), matUniform);
    thigh.position.y = -0.23;
    leg.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.46;
    leg.add(knee);

    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.15), matUniform);
    shin.position.y = -0.2;
    knee.add(shin);

    const kneepad = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.12, 0.055), matGear);
    kneepad.position.set(0, -0.01, -0.085);
    knee.add(kneepad);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.27), matBoot);
    boot.position.set(0, -0.425, -0.045); // toe toward -Z
    knee.add(boot);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.03, 0.29), matGear);
    sole.position.set(0, -0.475, -0.045);
    knee.add(sole);

    return { leg, knee };
  };
  const { leg: legL, knee: kneeL } = buildLeg(-0.095);
  const { leg: legR, knee: kneeR } = buildLeg(0.095);

  // Pelvis stays with the legs while the torso pitches above it.
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.23), matUniform);
  pelvis.position.y = 1.0;
  group.add(pelvis);

  // --------------------------------------------------------------- torso ---
  // Pivot at the waist: head, arms and rifle are all descendants → aim pitch
  // moves the entire upper body + weapon as one rigid unit.
  const torso = new THREE.Group();
  torso.position.y = WAIST_Y;
  group.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.24), matUniform);
  chest.position.y = 0.27;
  torso.add(chest);

  // Plate carrier + mag pouches (coyote) over the chest
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.055), matVest);
  plate.position.set(0, 0.28, -0.135);
  torso.add(plate);

  const pouchGeo = new THREE.BoxGeometry(0.085, 0.11, 0.05);
  const pouchL = new THREE.Mesh(pouchGeo, matVest);
  pouchL.position.set(-0.075, 0.2, -0.165);
  torso.add(pouchL);
  const pouchR = new THREE.Mesh(pouchGeo, matVest);
  pouchR.position.set(0.075, 0.2, -0.165);
  torso.add(pouchR);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.13), matVest);
  pack.position.set(0, 0.29, 0.185);
  torso.add(pack);

  const padGeo = new THREE.BoxGeometry(0.13, 0.07, 0.15);
  const padL = new THREE.Mesh(padGeo, matGear);
  padL.position.set(-0.225, 0.45, 0);
  torso.add(padL);
  const padR = new THREE.Mesh(padGeo, matGear);
  padR.position.set(0.225, 0.45, 0);
  torso.add(padR);

  // ---------------------------------------------------------------- head ---
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 10), matSkin);
  neck.position.y = 0.545;
  torso.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), matSkin);
  head.scale.y = 1.15; // head height ≈ 1/7.5 of body
  head.position.y = 0.64;
  torso.add(head);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    matUniform,
  );
  dome.position.y = 0.655;
  torso.add(dome);

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.018, 16), matUniform);
  brim.position.y = 0.625;
  torso.add(brim);

  const railGeo = new THREE.BoxGeometry(0.02, 0.035, 0.13);
  const railL = new THREE.Mesh(railGeo, matGear);
  railL.position.set(-0.12, 0.63, 0);
  torso.add(railL);
  const railR = new THREE.Mesh(railGeo, matGear);
  railR.position.set(0.12, 0.63, 0);
  torso.add(railR);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.028, 0.025), matVisor);
  visor.position.set(0, 0.6, -0.1);
  torso.add(visor);

  // ---------------------------------------------------------------- arms ---
  // Shoulder-pivot groups; the grip pose is baked in torso space via segment()
  // so both hands land on the rifle. Right hand at the grip, left hand on the
  // handguard — rolled sleeves: uniform upper arm, skin forearm + hand.
  const buildArm = (
    shoulder: THREE.Vector3,
    elbow: THREE.Vector3,
    hand: THREE.Vector3,
  ): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.copy(shoulder);
    torso.add(arm);
    const elbowL = new THREE.Vector3().subVectors(elbow, shoulder);
    const handL = new THREE.Vector3().subVectors(hand, shoulder);
    segment(new THREE.Vector3(0, 0, 0), elbowL, 0.105, 0.115, matUniform, arm);
    segment(elbowL, handL, 0.09, 0.09, matSkin, arm);
    const wristDir = new THREE.Vector3().subVectors(handL, elbowL).normalize();
    segment(handL, new THREE.Vector3().copy(handL).addScaledVector(wristDir, 0.06), 0.075, 0.095, matSkin, arm);
    return arm;
  };
  const armR = buildArm(
    new THREE.Vector3(0.235, 0.44, 0),
    new THREE.Vector3(0.27, 0.24, 0.04),
    new THREE.Vector3(0.09, 0.33, -0.085), // at the pistol grip
  );
  const armL = buildArm(
    new THREE.Vector3(-0.235, 0.44, 0),
    new THREE.Vector3(-0.1, 0.26, -0.18),
    new THREE.Vector3(0.07, 0.365, -0.32), // on the handguard
  );

  // --------------------------------------------------------------- rifle ---
  // Group origin at the grip so sway pivots where the right hand holds it.
  const rifle = new THREE.Group();
  rifle.position.set(0.09, 0.36, -0.1);
  torso.add(rifle);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.3), matRifle);
  receiver.position.set(0, 0.06, -0.06);
  rifle.add(receiver);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.085, 0.2), matRifle);
  stock.position.set(0, 0.045, 0.14); // butt seated at the shoulder
  rifle.add(stock);

  const barrelGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.24, 10);
  barrelGeo.rotateX(Math.PI / 2); // lie along Z
  const barrel = new THREE.Mesh(barrelGeo, matRifle);
  barrel.position.set(0, 0.075, -0.32);
  rifle.add(barrel);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.06), matRifle);
  mag.position.set(0, 0.005, -0.04);
  mag.rotation.x = 0.12; // slight forward cant
  rifle.add(mag);

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.075, 0.04), matRifle);
  foregrip.position.set(0, 0.01, -0.2);
  rifle.add(foregrip);

  const optic = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.09), matRifle);
  optic.position.set(0, 0.12, -0.08);
  rifle.add(optic);

  // ---------------------------------------------------------------- pose ---
  // Everything below mutates cached pivots only — zero allocations per frame.
  const setPose = (walkPhase: number, aimPitchRad: number): void => {
    const s = Math.sin(walkPhase);
    const swing = s * 0.5;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    // Trailing leg flexes its knee (heel lifts on push-off)
    kneeL.rotation.x = s < 0 ? s * 0.7 : 0;
    kneeR.rotation.x = s > 0 ? -s * 0.7 : 0;

    // +aim = lean the -Z-facing torso back → rifle muzzle rises toward the drone
    const aim = Math.max(-1.1, Math.min(1.1, aimPitchRad));
    const stride = Math.abs(s);
    torso.rotation.x = aim - 0.05 - stride * 0.04; // slight forward walk lean
    torso.rotation.z = s * 0.035; // hip/shoulder roll
    torso.rotation.y = s * 0.04; // shoulder yaw over the stride
    torso.position.y = WAIST_Y + Math.cos(walkPhase * 2) * 0.015; // 2x bob

    // Arms swing together (two-handed hold) against the left leg; rifle lags
    // with a small counter-sway so the weapon reads as carried mass.
    armL.rotation.x = -s * 0.045;
    armR.rotation.x = -s * 0.045;
    rifle.rotation.x = s * 0.02;
    rifle.rotation.z = Math.cos(walkPhase) * 0.02;
  };

  return { group, setPose };
}
