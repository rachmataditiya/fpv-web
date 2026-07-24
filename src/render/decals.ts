// FILE 2: src/render/decals.ts
import * as THREE from 'three';

export class DecalPool {
  private decalMeshes: THREE.Mesh[];
  private index: number = 0;
  private max: number;

  constructor(parent: THREE.Group | THREE.Scene, max: number = 32) {
    this.max = max;
    this.decalMeshes = [];

    const geometry = new THREE.CircleGeometry(0.08, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    for (let i = 0; i < max; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      parent.add(mesh);
      this.decalMeshes.push(mesh);
    }
  }

  add(point: THREE.Vector3, normal: THREE.Vector3): void {
    const mesh = this.decalMeshes[this.index];
    mesh.position.copy(point).addScaledVector(normal, 0.01);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.visible = true;
    this.index = (this.index + 1) % this.max;
  }

  clear(): void {
    for (const mesh of this.decalMeshes) {
      mesh.visible = false;
    }
  }
}
