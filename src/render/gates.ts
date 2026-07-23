import * as THREE from 'three';
import type { TrackDef } from '../world/track';

export interface GateVisuals {
  group: THREE.Group;
  setNext(index: number): void;
}

/**
 * Creates gate visuals from track data.
 * - Rectangular frames with support legs (if elevated)
 * - Shared blue base material (emissive ~0.35) + orange next (emissive ~1.0)
 * - Decorations: cones (orange, ~0.6m) and ramps (wedges)
 * - setNext(i) swaps material: previous-next back to base, gate i to next-material (static)
 * - Uses plain Groups with shared geometries/materials for ≤15 gates
 */
export function createGates(track: TrackDef): GateVisuals {
  const rootGroup = new THREE.Group();
  
  // Shared materials
  const matBase = new THREE.MeshStandardMaterial({
    color: 0x4488dd,
    emissive: 0x4488dd,
    emissiveIntensity: 0.7,
    roughness: 0.3,
    metalness: 0.2,
  });
  
  const matNext = new THREE.MeshStandardMaterial({
    color: 0xffb03b,
    emissive: 0xffb03b,
    emissiveIntensity: 1.0,
    roughness: 0.3,
    metalness: 0.2,
  });

  // Shared geometries
  const beamGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
  const legGeo = new THREE.BoxGeometry(0.1, 1.0, 0.1);
  const coneGeo = new THREE.ConeGeometry(0.3, 0.6, 16);
  
  // Store gate meshes for material swapping
  const gateBeams: Array<THREE.Mesh[]> = [];
  let currentNextIndex = -1;

  // Build gates
  track.gates.forEach((gateDef) => {
    const gateGroup = new THREE.Group();
    const beamMeshes: THREE.Mesh[] = [];
    
    // Gate frame: 4 beams (top, bottom, left, right)
    const { w, h } = gateDef.size;
    const beamThick = 0.32;
    
    // Top beam
    const topBeam = new THREE.Mesh(beamGeo, matBase);
    topBeam.scale.set(w + beamThick, beamThick, beamThick);
    topBeam.position.y = h / 2 + beamThick / 2;
    gateGroup.add(topBeam);
    beamMeshes.push(topBeam);
    
    // Bottom beam
    const botBeam = new THREE.Mesh(beamGeo, matBase);
    botBeam.scale.set(w + beamThick, beamThick, beamThick);
    botBeam.position.y = -h / 2 - beamThick / 2;
    gateGroup.add(botBeam);
    beamMeshes.push(botBeam);
    
    // Left beam
    const leftBeam = new THREE.Mesh(beamGeo, matBase);
    leftBeam.scale.set(beamThick, h, beamThick);
    leftBeam.position.x = -w / 2 - beamThick / 2;
    gateGroup.add(leftBeam);
    beamMeshes.push(leftBeam);
    
    // Right beam
    const rightBeam = new THREE.Mesh(beamGeo, matBase);
    rightBeam.scale.set(beamThick, h, beamThick);
    rightBeam.position.x = w / 2 + beamThick / 2;
    gateGroup.add(rightBeam);
    beamMeshes.push(rightBeam);
    
    // Support legs (if gate is elevated: pos.y - h/2 > 0.01)
    const groundY = gateDef.pos[1] - h / 2;
    if (groundY > 0.01) {
      const legHeight = groundY;
      
      // Front-left leg
      const legFL = new THREE.Mesh(legGeo, matBase);
      legFL.scale.y = legHeight;
      legFL.position.set(-w / 3, -h / 2 - legHeight / 2, -0.2);
      gateGroup.add(legFL);
      beamMeshes.push(legFL);
      
      // Front-right leg
      const legFR = new THREE.Mesh(legGeo, matBase);
      legFR.scale.y = legHeight;
      legFR.position.set(w / 3, -h / 2 - legHeight / 2, -0.2);
      gateGroup.add(legFR);
      beamMeshes.push(legFR);
    }
    
    // Flags for 'flag' kind
    if (gateDef.kind === 'flag') {
      const flagGeo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        -w / 2 - beamThick / 2, h / 2 + beamThick / 2, -0.15,
        w / 2 + beamThick / 2, h / 2 + beamThick / 2, -0.15,
        0, h / 2 + beamThick, 0.05,
      ]);
      const indices = new Uint32Array([0, 1, 2]);
      flagGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      flagGeo.setIndex(new THREE.BufferAttribute(indices, 1));
      
      const flag = new THREE.Mesh(flagGeo, matBase);
      gateGroup.add(flag);
      beamMeshes.push(flag);
    }
    
    // Position and rotate gate
    gateGroup.position.set(gateDef.pos[0], gateDef.pos[1], gateDef.pos[2]);
    gateGroup.rotation.y = (gateDef.yawDeg * Math.PI) / 180;
    
    rootGroup.add(gateGroup);
    gateBeams.push(beamMeshes);
  });

  // Add decorations — shared materials/geometry, cones sit ON the ground
  // (ConeGeometry is center-origin, so lift by half its height × scale).
  if (track.decorations) {
    const matCone = new THREE.MeshStandardMaterial({ color: 0xff9900, roughness: 0.4, metalness: 0.1 });
    const matRamp = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5, metalness: 0.1 });
    const rampGeo = new THREE.BoxGeometry(1.0, 0.5, 0.5);
    track.decorations.forEach((dec) => {
      if (dec.type === 'cone') {
        const cone = new THREE.Mesh(coneGeo, matCone);
        const s = dec.scale ?? 1;
        cone.position.set(dec.pos[0], dec.pos[1] + 0.3 * s, dec.pos[2]);
        cone.scale.setScalar(s);
        if (dec.yawDeg) cone.rotation.y = (dec.yawDeg * Math.PI) / 180;
        rootGroup.add(cone);
      } else if (dec.type === 'ramp') {
        const ramp = new THREE.Mesh(rampGeo, matRamp);
        ramp.position.set(dec.pos[0], dec.pos[1] + 0.25, dec.pos[2]);
        if (dec.scale) ramp.scale.setScalar(dec.scale);
        if (dec.yawDeg) ramp.rotation.y = (dec.yawDeg * Math.PI) / 180;
        ramp.rotation.z = Math.atan2(0.5, 1.0);
        rootGroup.add(ramp);
      }
    });
  }

  // setNext: swaps material on gate groups (static, no per-frame work)
  const setNext = (index: number): void => {
    if (currentNextIndex >= 0 && currentNextIndex < gateBeams.length) {
      gateBeams[currentNextIndex].forEach((mesh) => {
        mesh.material = matBase;
      });
    }

    if (index >= 0 && index < gateBeams.length) {
      gateBeams[index].forEach((mesh) => {
        mesh.material = matNext;
      });
      currentNextIndex = index;
    } else {
      currentNextIndex = -1;
    }
  };

  return {
    group: rootGroup,
    setNext,
  };
}
