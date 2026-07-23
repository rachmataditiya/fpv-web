import * as THREE from 'three';

/**
 * Creates a stylized low-poly soldier (~1.8m tall).
 * - Origin at feet, forward is -Z (matches createDroneMesh convention)
 * - Pivot groups: legs at the hips, torso at the waist — setPose swings the
 *   legs by walkPhase and pitches the torso (with arms + rifle) toward the aim
 * - Boxy silhouette, olive drab + dark gear, emissive red visor (enemy read)
 * - 10 meshes, 5 shared materials, no per-frame allocations in setPose
 */
export const SOLDIER_HEIGHT = 1.8;

const HIP_Y = 0.85;

export interface SoldierMesh {
  group: THREE.Group;
  /** walkPhase: rad accumulator (legs swing by sin); aimPitchRad: + = aim up. */
  setPose(walkPhase: number, aimPitchRad: number): void;
}

export function createSoldierMesh(): SoldierMesh {
  const group = new THREE.Group();

  // Shared materials (5 total)
  const matUniform = new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 0.85, metalness: 0.05 });
  const matGear = new THREE.MeshStandardMaterial({ color: 0x2a2d26, roughness: 0.7, metalness: 0.2 });
  const matSkin = new THREE.MeshStandardMaterial({ color: 0xc9a27b, roughness: 0.8, metalness: 0 });
  const matRifle = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.6 });
  const matVisor = new THREE.MeshStandardMaterial({
    color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.4,
  });

  // Legs — pivot at the hip, box hangs down
  const legGeo = new THREE.BoxGeometry(0.13, HIP_Y, 0.16);
  const legL = new THREE.Group();
  legL.position.set(-0.09, HIP_Y, 0);
  const legLMesh = new THREE.Mesh(legGeo, matGear);
  legLMesh.position.y = -HIP_Y / 2;
  legL.add(legLMesh);
  group.add(legL);

  const legR = new THREE.Group();
  legR.position.set(0.09, HIP_Y, 0);
  const legRMesh = new THREE.Mesh(legGeo, matGear);
  legRMesh.position.y = -HIP_Y / 2;
  legR.add(legRMesh);
  group.add(legR);

  // Torso — pivot at the waist; head, arms, and rifle ride along on aim pitch
  const torso = new THREE.Group();
  torso.position.y = HIP_Y;
  group.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.55, 0.22), matUniform);
  chest.position.y = 0.28;
  torso.add(chest);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.12), matGear);
  pack.position.set(0, 0.3, 0.17);
  torso.add(pack);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), matSkin);
  head.position.y = 0.66;
  torso.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), matUniform);
  helmet.position.y = 0.68;
  torso.add(helmet);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.04), matVisor);
  visor.position.set(0, 0.66, -0.09);
  torso.add(visor);

  // Arms — boxes raised toward the rifle grip (shoulder-pivoted look baked in)
  const armGeo = new THREE.BoxGeometry(0.09, 0.42, 0.11);
  const armL = new THREE.Mesh(armGeo, matUniform);
  armL.position.set(-0.21, 0.38, -0.12);
  armL.rotation.x = -1.15;
  torso.add(armL);

  const armR = new THREE.Mesh(armGeo, matUniform);
  armR.position.set(0.21, 0.38, -0.12);
  armR.rotation.x = -1.15;
  torso.add(armR);

  // Rifle — held forward along -Z between the hands
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.62), matRifle);
  rifle.position.set(0.04, 0.42, -0.34);
  torso.add(rifle);

  const setPose = (walkPhase: number, aimPitchRad: number): void => {
    const swing = Math.sin(walkPhase) * 0.55;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    // + pitch = aim up = tilt the (−Z-facing) torso back around X
    const clamped = Math.max(-1, Math.min(1, aimPitchRad));
    torso.rotation.x = -clamped * 0.7;
  };

  return { group, setPose };
}
