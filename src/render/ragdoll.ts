// FILE 1: src/render/ragdoll.ts
import * as THREE from 'three';

export interface RagdollCorpse {
  group: THREE.Group;
  step(dt: number, floorAt: (x: number, z: number) => number | null): void;
  energy(): number;
  age: number;
}

interface Particle {
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
}

interface Constraint {
  p1: Particle;
  p2: Particle;
  restLength: number;
}

class RagdollCorpseImpl implements RagdollCorpse {
  group: THREE.Group;
  age: number = 0;
  private lowEnergyTime: number = 0;
  private particles: Particle[];
  private constraints: Constraint[];
  private meshes: THREE.Mesh[];
  private initImpulse: THREE.Vector3;
  private initialized: boolean = false;

  constructor(pos: THREE.Vector3, impulse: THREE.Vector3) {
    this.group = new THREE.Group();
    this.initImpulse = impulse.clone();

    const localPositions = [
      new THREE.Vector3(0, 0.25, 0),   // head
      new THREE.Vector3(0, 0, 0),      // chest
      new THREE.Vector3(0, -0.4, 0),   // pelvis
      new THREE.Vector3(-0.3, 0.1, 0), // handL
      new THREE.Vector3(0.3, 0.1, 0),  // handR
      new THREE.Vector3(0, -0.9, 0),   // feet
    ];

    this.particles = localPositions.map(lp => {
      const pPos = pos.clone().add(lp);
      return {
        pos: pPos.clone(),
        prevPos: pPos.clone(), // will be corrected on first step
      };
    });

    const [head, chest, pelvis, handL, handR, feet] = this.particles;

    this.constraints = [
      { p1: head, p2: chest, restLength: 0.25 },
      { p1: chest, p2: pelvis, restLength: 0.4 },
      { p1: chest, p2: handL, restLength: Math.sqrt(0.3 * 0.3 + 0.1 * 0.1) },
      { p1: chest, p2: handR, restLength: Math.sqrt(0.3 * 0.3 + 0.1 * 0.1) },
      { p1: pelvis, p2: feet, restLength: 0.5 },
    ];

    const material = new THREE.MeshStandardMaterial({ color: 0x55613f });

    const chestGeo = new THREE.BoxGeometry(0.3, 0.5, 0.3);
    const chestMesh = new THREE.Mesh(chestGeo, material);
    chestMesh.position.copy(chest.pos);
    this.group.add(chestMesh);

    const headGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const headMesh = new THREE.Mesh(headGeo, material);
    headMesh.position.copy(head.pos);
    this.group.add(headMesh);

    const pelvisGeo = new THREE.BoxGeometry(0.25, 0.2, 0.2);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, material);
    pelvisMesh.position.copy(pelvis.pos);
    this.group.add(pelvisMesh);

    const feetGeo = new THREE.BoxGeometry(0.2, 0.1, 0.3);
    const feetMesh = new THREE.Mesh(feetGeo, material);
    feetMesh.position.copy(feet.pos);
    this.group.add(feetMesh);

    const handGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const handLMesh = new THREE.Mesh(handGeo, material);
    handLMesh.position.copy(handL.pos);
    this.group.add(handLMesh);
    const handRMesh = new THREE.Mesh(handGeo, material);
    handRMesh.position.copy(handR.pos);
    this.group.add(handRMesh);

    this.meshes = [chestMesh, headMesh, pelvisMesh, feetMesh, handLMesh, handRMesh];
  }

  step(dt: number, floorAt: (x: number, z: number) => number | null): void {
    if (!this.initialized) {
      for (const p of this.particles) {
        p.prevPos.copy(p.pos.clone().sub(this.initImpulse.clone().multiplyScalar(dt)));
      }
      this.initialized = true;
    }

    this.age += dt;
    const gravity = new THREE.Vector3(0, -9.8, 0);

    // Verlet integration
    for (const p of this.particles) {
      const velocity = new THREE.Vector3().subVectors(p.pos, p.prevPos);
      p.prevPos.copy(p.pos);
      p.pos.add(velocity.add(gravity.clone().multiplyScalar(dt * dt)));
    }

    // Constraints (2 iterations)
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.constraints) {
        const delta = new THREE.Vector3().subVectors(c.p1.pos, c.p2.pos);
        const dist = delta.length();
        if (dist === 0) continue;
        const correction = (c.restLength - dist) / dist * 0.5;
        const offset = delta.multiplyScalar(correction);
        c.p1.pos.add(offset);
        c.p2.pos.sub(offset);
      }
    }

    // Floor collisions
    for (const p of this.particles) {
      const floorY = floorAt(p.pos.x, p.pos.z);
      if (floorY !== null && p.pos.y < floorY) {
        const velocity = new THREE.Vector3().subVectors(p.pos, p.prevPos);
        const newVelY = -velocity.y * 0.2;
        const newVelX = velocity.x * 0.4; // 1 - friction (friction=0.6) => 0.4
        const newVelZ = velocity.z * 0.4;
        p.pos.y = floorY;
        p.prevPos.set(
          p.pos.x - newVelX,
          p.pos.y - newVelY,
          p.pos.z - newVelZ
        );
      }
    }

    // Update mesh positions
    for (let i = 0; i < this.particles.length; i++) {
      this.meshes[i].position.copy(this.particles[i].pos);
    }

    // Auto-sleep check
    if (this.energy() < 0.01) {
      this.lowEnergyTime += dt;
    } else {
      this.lowEnergyTime = 0;
    }
    if (this.age > 6 || this.lowEnergyTime > 1) {
      this.group.visible = false;
    }
  }

  energy(): number {
    let total = 0;
    for (const p of this.particles) {
      const vel = new THREE.Vector3().subVectors(p.pos, p.prevPos);
      total += vel.lengthSq();
    }
    return 0.5 * total;
  }
}

export class RagdollPool {
  private corpses: RagdollCorpseImpl[];
  private nextIndex: number = 0;
  private size: number;
  private scene: THREE.Object3D;

  constructor(scene: THREE.Group | THREE.Scene, size: number = 4) {
    this.scene = scene;
    this.size = size;
    this.corpses = [];
    // Pre-populate pool with hidden corpses
    for (let i = 0; i < size; i++) {
      const corpse = new RagdollCorpseImpl(new THREE.Vector3(0, -10, 0), new THREE.Vector3());
      corpse.group.visible = false;
      this.scene.add(corpse.group);
      this.corpses.push(corpse);
    }
  }

  spawn(pos: THREE.Vector3, impulse: THREE.Vector3): void {
    const oldCorpse = this.corpses[this.nextIndex];
    this.scene.remove(oldCorpse.group);
    const newCorpse = new RagdollCorpseImpl(pos, impulse);
    this.scene.add(newCorpse.group);
    this.corpses[this.nextIndex] = newCorpse;
    this.nextIndex = (this.nextIndex + 1) % this.size;
  }

  update(dt: number, floorAt: (x: number, z: number) => number | null): void {
    for (const corpse of this.corpses) {
      if (corpse.group.visible) {
        corpse.step(dt, floorAt);
      }
    }
  }
}
