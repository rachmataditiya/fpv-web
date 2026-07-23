import * as THREE from 'three';

interface TracerSlot {
  line: THREE.Line;
  active: boolean;
  life: number;
}

interface MuzzleSlot {
  sprite: THREE.Sprite;
  active: boolean;
  life: number;
}

interface ExplosionSlot {
  points: THREE.Points;
  positions: THREE.BufferAttribute;
  velocities: Float32Array;
  active: boolean;
  life: number;
  maxLife: number;
}

export class FxSystem {
  private scene: THREE.Scene;
  private tracerSize = 8;
  private muzzleSize = 4;
  private explosionSize = 4;

  private tracerSlots: TracerSlot[] = [];
  private tracerIdx = 0;
  private muzzleSlots: MuzzleSlot[] = [];
  private muzzleIdx = 0;
  private explosionSlots: ExplosionSlot[] = [];
  private explosionIdx = 0;
  private impactSlots: ExplosionSlot[] = [];
  private impactIdx = 0;
  private impactSize = 8;
  private particleSlots: ExplosionSlot[] = []; // explosions + impacts, combined once

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initTracers();
    this.initMuzzles();
    this.initExplosions();
    this.initImpacts();
    this.particleSlots = [...this.explosionSlots, ...this.impactSlots];
  }

  private initTracers() {
    const mat = new THREE.LineBasicMaterial({
      color: 0xfff2b0,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    for (let i = 0; i < this.tracerSize; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, mat.clone()); // clone to allow individual opacity
      line.visible = false;
      this.scene.add(line);
      this.tracerSlots.push({ line, active: false, life: 0 });
    }
  }

  private initMuzzles() {
    for (let i = 0; i < this.muzzleSize; i++) {
      const mat = new THREE.SpriteMaterial({
        color: 0xffc46b,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 1,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.scale.set(0, 0, 0);
      this.scene.add(sprite);
      this.muzzleSlots.push({ sprite, active: false, life: 0 });
    }
  }

  private initExplosions() {
    const particleCount = 48;
    for (let i = 0; i < this.explosionSize; i++) {
      const positionsArr = new Float32Array(particleCount * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positionsArr, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xff9540,
        blending: THREE.AdditiveBlending,
        size: 0.35,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      this.scene.add(points);
      this.explosionSlots.push({
        points,
        positions: geo.attributes.position as THREE.BufferAttribute,
        velocities: new Float32Array(particleCount * 3),
        active: false,
        life: 0,
        maxLife: 0.7,
      });
    }
  }

  private initImpacts() {
    // small dust/spark puffs where bullets strike world geometry
    const particleCount = 14;
    for (let i = 0; i < this.impactSize; i++) {
      const positionsArr = new Float32Array(particleCount * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positionsArr, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xd8c7a4,
        size: 0.12,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      this.scene.add(points);
      this.impactSlots.push({
        points,
        positions: geo.attributes.position as THREE.BufferAttribute,
        velocities: new Float32Array(particleCount * 3),
        active: false,
        life: 0,
        maxLife: 0.35,
      });
    }
  }

  /** Bullet impact puff on world geometry. */
  impact(pos: THREE.Vector3) {
    const slot = this.impactSlots[this.impactIdx];
    this.impactIdx = (this.impactIdx + 1) % this.impactSize;
    slot.active = true;
    slot.life = slot.maxLife;
    slot.points.visible = true;
    slot.points.position.copy(pos);
    const posArr = slot.positions.array as Float32Array;
    const velArr = slot.velocities;
    const count = posArr.length / 3;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      posArr[i3] = pos.x; posArr[i3 + 1] = pos.y; posArr[i3 + 2] = pos.z;
      const phi = Math.random() * Math.PI * 0.6;
      const theta = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      velArr[i3] = speed * Math.sin(phi) * Math.cos(theta);
      velArr[i3 + 1] = speed * Math.cos(phi);
      velArr[i3 + 2] = speed * Math.sin(phi) * Math.sin(theta);
    }
    slot.positions.needsUpdate = true;
    (slot.points.material as THREE.PointsMaterial).opacity = 1;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const slot = this.tracerSlots[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracerSize;
    slot.active = true;
    slot.life = 0.09;
    slot.line.visible = true;
    const posAttr = slot.line.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
    arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
    posAttr.needsUpdate = true;
  }

  muzzle(pos: THREE.Vector3) {
    const slot = this.muzzleSlots[this.muzzleIdx];
    this.muzzleIdx = (this.muzzleIdx + 1) % this.muzzleSize;
    slot.active = true;
    slot.life = 0.05;
    slot.sprite.visible = true;
    slot.sprite.position.copy(pos);
    slot.sprite.scale.set(0.5, 0.5, 0.5);
    (slot.sprite.material as THREE.SpriteMaterial).opacity = 1;
  }

  explosion(pos: THREE.Vector3) {
    const slot = this.explosionSlots[this.explosionIdx];
    this.explosionIdx = (this.explosionIdx + 1) % this.explosionSize;
    slot.active = true;
    slot.life = slot.maxLife;
    slot.points.visible = true;
    slot.points.position.copy(pos);
    const posArr = slot.positions.array as Float32Array;
    const velArr = slot.velocities;
    const count = posArr.length / 3;
    // set all particles to spawn position, random velocity with upward bias
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      posArr[i3] = pos.x;
      posArr[i3 + 1] = pos.y;
      posArr[i3 + 2] = pos.z;
      // random unit vector, upward hemispherical (y positive)
      const phi = Math.random() * Math.PI * 0.5; // [0, PI/2]
      const theta = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 11; // 3–14
      velArr[i3] = speed * Math.sin(phi) * Math.cos(theta);
      velArr[i3 + 1] = speed * Math.cos(phi); // always positive (upward)
      velArr[i3 + 2] = speed * Math.sin(phi) * Math.sin(theta);
    }
    slot.positions.needsUpdate = true;
    (slot.points.material as THREE.PointsMaterial).opacity = 1;
  }

  update(dt: number) {
    // Tracers
    for (const slot of this.tracerSlots) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.line.visible = false;
      } else {
        (slot.line.material as THREE.LineBasicMaterial).opacity = slot.life / 0.09;
      }
    }

    // Muzzles
    for (const slot of this.muzzleSlots) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.sprite.visible = false;
      } else {
        const scale = 0.15 + 0.35 * (slot.life / 0.05);
        slot.sprite.scale.set(scale, scale, scale);
        (slot.sprite.material as THREE.SpriteMaterial).opacity = slot.life / 0.05;
      }
    }

    // Explosions + impact puffs (same particle update)
    for (const slot of this.particleSlots) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.points.visible = false;
      } else {
        const posArr = slot.positions.array as Float32Array;
        const velArr = slot.velocities;
        const count = posArr.length / 3;
        for (let i = 0; i < count; i++) {
          const i3 = i * 3;
          posArr[i3] += velArr[i3] * dt;
          posArr[i3 + 1] += velArr[i3 + 1] * dt;
          posArr[i3 + 2] += velArr[i3 + 2] * dt;
          velArr[i3 + 1] -= 9.8 * dt; // gravity
        }
        slot.positions.needsUpdate = true;
        // opacity fades to 0 during last 60% of lifetime
        const fraction = slot.life / slot.maxLife;
        const opacity = fraction > 0.4 ? 1 : fraction / 0.4;
        (slot.points.material as THREE.PointsMaterial).opacity = opacity;
      }
    }
  }
}
