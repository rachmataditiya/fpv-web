import * as THREE from 'three';

/** Options accepted by createDroneMesh. */
export interface DroneMeshOptions {
  /** Recolors the "enemy read" parts: props, sensor eye, rear LED. */
  accent?: number;
}

/**
 * Procedural heavy "interceptor" quad (~0.37m across, built at player-drone
 * scale — the bot caller scales it 3x). Menacing read via silhouette, not
 * textures: faceted angular canopy (4-sided lathed cylinder), flared duct
 * guards around each prop, emissive sensor eye in a dark bezel, twin whip
 * antennas, and landing skids.
 * - 29 meshes, 5 shared materials, ~800 tris; origin at center of mass,
 *   forward is -Z, Y-up, 1 unit = 1 meter.
 * - accent (default enemy red 0xff2222) touches ONLY the parts that must read
 *   as "enemy": prop blades, the sensor eye, and the rear LED.
 * - No per-frame function here: callers drive position/yaw themselves.
 */
export function createDroneMesh(opts?: DroneMeshOptions): THREE.Group {
  const accent = opts?.accent ?? 0xff2222;
  const group = new THREE.Group();

  // Shared materials (5 total) — tuned for outdoor HDRI, not flat color
  const matHull = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.35, metalness: 0.75 });
  const matFrame = new THREE.MeshStandardMaterial({
    color: 0x2c2f33, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide, // ducts need inner faces
  });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.5, metalness: 0.6 });
  const matProp = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.9,
  });
  const matEye = new THREE.MeshStandardMaterial({
    color: accent, emissive: accent, emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.4,
  });

  // ----------------------------------------------------------------- hull ---
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.26), matHull);
  hull.position.y = -0.012;
  group.add(hull);

  // Faceted canopy: a 4-sided cylinder laid along Z reads as an angular spine
  const canopyGeo = new THREE.CylinderGeometry(0.07, 0.088, 0.28, 4);
  canopyGeo.rotateX(Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, matHull);
  canopy.scale.y = 0.55; // flatten the diamond cross-section → sleek wedge
  canopy.position.set(0, 0.02, -0.01);
  group.add(canopy);

  // Sensor eye: emissive accent sphere in a dark bezel ring, nose front (-Z)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), matEye);
  eye.position.set(0, 0.015, -0.148);
  group.add(eye);

  const bezelGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.018, 12, 1, true);
  bezelGeo.rotateX(Math.PI / 2);
  const bezel = new THREE.Mesh(bezelGeo, matDark);
  bezel.position.set(0, 0.015, -0.15);
  group.add(bezel);

  // Rear LED (+Z) — enemy read from behind
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), matEye);
  led.position.set(0, 0.01, 0.135);
  group.add(led);

  // ------------------------------------------- arms / ducts / motors/props ---
  // Four corners at (±0.125, ±0.125) → 0.37m across including the duct rings.
  const corners: Array<[number, number]> = [
    [-0.125, -0.125],
    [0.125, -0.125],
    [-0.125, 0.125],
    [0.125, 0.125],
  ];
  const armGeo = new THREE.BoxGeometry(0.115, 0.008, 0.024);
  const ductGeo = new THREE.CylinderGeometry(0.058, 0.05, 0.034, 18, 1, true); // flared lip
  const motorGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.022, 10);
  const propGeo = new THREE.BoxGeometry(0.094, 0.003, 0.016);
  const propAngles = [0.4, 1.3, 2.2, 0.9]; // deterministic blade offsets

  corners.forEach(([cx, cz], i) => {
    const arm = new THREE.Mesh(armGeo, matFrame);
    arm.position.set(cx * 0.7, 0.006, cz * 0.7);
    arm.rotation.y = Math.atan2(-cz, cx); // point along its diagonal (X-frame)
    group.add(arm);

    const duct = new THREE.Mesh(ductGeo, matFrame);
    duct.position.set(cx, 0.018, cz);
    group.add(duct);

    const motor = new THREE.Mesh(motorGeo, matDark);
    motor.position.set(cx, 0.008, cz);
    group.add(motor);

    const prop = new THREE.Mesh(propGeo, matProp);
    prop.position.set(cx, 0.026, cz); // inside the duct ring
    prop.rotation.y = propAngles[i];
    group.add(prop);
  });

  // -------------------------------------------------------------- details ---
  // Twin whip antennas at the rear, tilted back and splayed out
  const antennaGeo = new THREE.CylinderGeometry(0.0016, 0.0016, 0.085, 5);
  const antennaL = new THREE.Mesh(antennaGeo, matDark);
  antennaL.position.set(-0.034, 0.048, 0.105);
  antennaL.rotation.set(-0.45, 0, 0.3);
  group.add(antennaL);
  const antennaR = new THREE.Mesh(antennaGeo, matDark);
  antennaR.position.set(0.034, 0.048, 0.105);
  antennaR.rotation.set(-0.45, 0, -0.3);
  group.add(antennaR);

  // Landing skids: 4 struts + 2 foot bars, lowest point at y ≈ -0.078
  const strutGeo = new THREE.BoxGeometry(0.012, 0.05, 0.012);
  const strutPositions: Array<[number, number, number]> = [
    [-0.062, -0.042, -0.055],
    [0.062, -0.042, -0.055],
    [-0.062, -0.042, 0.055],
    [0.062, -0.042, 0.055],
  ];
  strutPositions.forEach(([x, y, z]) => {
    const strut = new THREE.Mesh(strutGeo, matFrame);
    strut.position.set(x, y, z);
    group.add(strut);
  });

  const footGeo = new THREE.BoxGeometry(0.02, 0.012, 0.24);
  const footL = new THREE.Mesh(footGeo, matFrame);
  footL.position.set(-0.062, -0.072, 0);
  group.add(footL);
  const footR = new THREE.Mesh(footGeo, matFrame);
  footR.position.set(0.062, -0.072, 0);
  group.add(footR);

  return group;
}
