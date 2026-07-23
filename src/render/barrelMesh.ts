// barrelMesh.ts — Three.js explosive barrel with shared geometries and materials.
//
// Requirements:
//   • Red cylinder body, 14 segments, diameter 0.7 m, height 0.9 m, PBR material.
//   • Two darker rim rings (Torus) at 1/4 and 3/4 of the height.
//   • Yellow‑amber hazard band (emissive) around the middle.
//   • Flat lid with a small center cap.
//   • ≤ 7 meshes per barrel.
//   • Module‑level geometries & materials created once and reused.
//   • Group origin at the base center (sitting on Y=0 ground).

import * as THREE from 'three';

export const BARREL_RADIUS = 1.05;   // m (3× — big oil-tank style, fun to shoot)
export const BARREL_HEIGHT = 2.7;    // m

// ---------- shared geometries (created lazily) ----------
let bodyGeometry: THREE.CylinderGeometry;
let rimGeometry: THREE.TorusGeometry;
let hazardGeometry: THREE.CylinderGeometry;
let lidGeometry: THREE.CylinderGeometry;
let capGeometry: THREE.CylinderGeometry;

// ---------- shared materials (created lazily) ----------
let bodyMaterial: THREE.MeshStandardMaterial;
let rimMaterial: THREE.MeshStandardMaterial;
let hazardMaterial: THREE.MeshStandardMaterial;
let lidMaterial: THREE.MeshStandardMaterial;
let capMaterial: THREE.MeshStandardMaterial;

/**
 * Creates a reusable explosive barrel mesh (Group) with its origin at the base.
 */
export function createBarrelMesh(): THREE.Group {
  ensureSharedResources();

  const group = new THREE.Group();

  // --- body (red cylinder) ---
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = BARREL_HEIGHT / 2;   // shift up so base is at y=0
  group.add(body);

  // --- two rim rings (torus, darker, placed at 1/4 and 3/4) ---
  const positions = [BARREL_HEIGHT * 0.25, BARREL_HEIGHT * 0.75];
  const rim0 = new THREE.Mesh(rimGeometry, rimMaterial);
  rim0.rotation.x = Math.PI / 2;        // torus lies horizontally
  rim0.position.y = positions[0];
  const rim1 = rim0.clone();
  rim1.position.y = positions[1];
  group.add(rim0, rim1);

  // --- hazard band (thin emissive cylinder) ---
  const band = new THREE.Mesh(hazardGeometry, hazardMaterial);
  band.position.y = BARREL_HEIGHT / 2;  // center of body == center of band
  group.add(band);

  // --- flat lid (thin disc) ---
  const lidY = BARREL_HEIGHT + lidGeometry.parameters.height / 2; // bottom of lid at 0.9
  const lid = new THREE.Mesh(lidGeometry, lidMaterial);
  lid.position.y = lidY;
  group.add(lid);

  // --- center cap (small cylinder on top of the lid) ---
  const capY = lidY + lidGeometry.parameters.height / 2 + capGeometry.parameters.height / 2;
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.position.y = capY;
  group.add(cap);

  return group;
}

// ---------------------------------------------------------------------------
// Internal one‑time initialisation of geometries and materials
// ---------------------------------------------------------------------------
function ensureSharedResources(): void {
  if (bodyGeometry) return;   // already created

  // ----- geometries -----
  bodyGeometry = new THREE.CylinderGeometry(
    BARREL_RADIUS, BARREL_RADIUS, BARREL_HEIGHT, 14
  );

  // torus for rim: major radius = barrel radius, tube radius small
  rimGeometry = new THREE.TorusGeometry(BARREL_RADIUS, 0.1, 8, 20);

  // hazard band: same outer dimensions, very thin
  // slightly larger radius than the body so the band never z-fights it
  hazardGeometry = new THREE.CylinderGeometry(
    BARREL_RADIUS * 1.02, BARREL_RADIUS * 1.02, 0.35, 14
  );

  // lid: same radius, tiny height
  lidGeometry = new THREE.CylinderGeometry(
    BARREL_RADIUS, BARREL_RADIUS, 0.06, 14
  );

  // center cap: small cylinder
  capGeometry = new THREE.CylinderGeometry(0.24, 0.24, 0.09, 8);

  // ----- materials -----
  bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x9e1b1b,
    roughness: 0.6,
    metalness: 0.3,
  });

  rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a0e0e,
    roughness: 0.7,
    metalness: 0.3,
  });

  hazardMaterial = new THREE.MeshStandardMaterial({
    color: 0xffb03b,
    roughness: 0.6,
    metalness: 0.3,
    emissive: 0xffb03b,
    emissiveIntensity: 0.5,
  });

  lidMaterial = bodyMaterial;   // reuse body material for lid
  capMaterial = rimMaterial;    // reuse rim material for cap
}
