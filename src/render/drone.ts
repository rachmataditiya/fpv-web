import * as THREE from 'three';

/**
 * Creates a stylized 5" racing quad (~0.25m across).
 * - Flat center plate, 4 thin arms (X-frame rotated ±45°)
 * - 4 prop discs (flat cylinders, semi-transparent)
 * - FPV camera block at front (-Z), emissive red rear LED (+Z)
 * - Front props orange, rear grey
 * - <15 meshes, ≤5 materials, props at y≈0.02
 * 
 * @param opts.accent recolors the front props + LED (enemy bots use red);
 *                    default keeps the player's orange/red scheme
 * @returns Group with origin at center of mass; forward is -Z
 */
export function createDroneMesh(opts?: { accent?: number }): THREE.Group {
  const accent = opts?.accent;
  const group = new THREE.Group();

  // Shared materials (5 total)
  const matBody = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.4,
    metalness: 0.6,
  });
  const matArm = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.5,
    metalness: 0.5,
  });
  const matPropFront = new THREE.MeshStandardMaterial({
    color: accent ?? 0xff8800,
    roughness: 0.6,
    metalness: 0.2,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  const matPropRear = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.6,
    metalness: 0.2,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  const matLED = new THREE.MeshStandardMaterial({
    color: accent ?? 0xff2222,
    emissive: accent ?? 0xff2222,
    emissiveIntensity: 1.0,
    roughness: 0.2,
    metalness: 0.8,
  });

  // Center plate (flat box)
  const plateMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.02, 0.24),
    matBody
  );
  plateMesh.position.y = 0.005;
  group.add(plateMesh);

  // FPV camera block at front (-Z), small and canted
  const camMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.04, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.3,
      metalness: 0.7,
    })
  );
  camMesh.position.set(0, 0.01, -0.12);
  camMesh.rotation.x = -0.2;
  group.add(camMesh);

  // Rear emissive LED at (+Z)
  const ledMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 8),
    matLED
  );
  ledMesh.position.set(0, 0.03, 0.12);
  group.add(ledMesh);

  // Arms: 4 thin boxes (X-frame)
  const armThick = 0.008;
  const armHeight = 0.008;
  
  const armPositions: Array<[number, number, number]> = [
    [-0.1, 0, -0.1],
    [0.1, 0, -0.1],
    [-0.1, 0, 0.1],
    [0.1, 0, 0.1],
  ];

  armPositions.forEach(([x, y, z]) => {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, armHeight, armThick),
      matArm
    );
    arm.position.set(x, y, z);
    arm.rotation.y = Math.atan2(-z, x); // point each arm along its diagonal (X-frame)
    group.add(arm);
  });

  // Prop discs: 4 flat cylinders at y≈0.02
  // Front props (orange), rear props (grey)
  const propRadius = 0.06;
  const propThickness = 0.003;
  const propY = 0.02;

  const propPositions: Array<[number, number, number, THREE.Material]> = [
    [-0.125, propY, -0.125, matPropFront],
    [0.125, propY, -0.125, matPropFront],
    [-0.125, propY, 0.125, matPropRear],
    [0.125, propY, 0.125, matPropRear],
  ];

  propPositions.forEach(([x, y, z, mat]) => {
    const prop = new THREE.Mesh(
      new THREE.CylinderGeometry(propRadius, propRadius, propThickness, 32),
      mat
    );
    prop.position.set(x, y, z);
    group.add(prop);
  });

  return group;
}
