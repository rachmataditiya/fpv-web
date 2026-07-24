import * as THREE from 'three';

/** Shared soft radial-gradient texture — untextured Sprites/Points render as
 *  hard SQUARES; this makes every particle a feathered disc. */
let _softTex: THREE.CanvasTexture | null = null;
function softCircleTexture(): THREE.CanvasTexture {
  if (_softTex) return _softTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _softTex = new THREE.CanvasTexture(c);
  return _softTex;
}

interface TracerSlot {
  line: THREE.Line;
  active: boolean;
  life: number;
}

interface MuzzleSlot {
  sprite: THREE.Sprite;
  active: boolean;
  life: number;
  /** Scale multiplier (railgun muzzle is bigger than a blaster's). */
  boost: number;
}

interface ExplosionSlot {
  points: THREE.Points;
  positions: THREE.BufferAttribute;
  velocities: Float32Array;
  active: boolean;
  life: number;
  maxLife: number;
  /** Vertical acceleration: −9.8 for debris/sparks, positive for buoyant smoke. */
  accelY: number;
}

interface FireballSlot {
  sprite: THREE.Sprite;
  active: boolean;
  life: number;
}

const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

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
  private fireballSlots: FireballSlot[] = [];
  private fireballIdx = 0;
  private smokeSlots: ExplosionSlot[] = [];
  private smokeIdx = 0;
  private sparkSlots: ExplosionSlot[] = [];
  private sparkIdx = 0;
  private puffSlots: ExplosionSlot[] = [];
  private puffIdx = 0;
  private particleSlots: ExplosionSlot[] = []; // explosions + impacts, combined once

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initTracers();
    this.initMuzzles();
    this.initExplosions();
    this.initImpacts();
    this.initFireballs();
    this.smokeSlots = this.makeParticlePool(4, 24, 0x2e2a26, 1.7, 1.8, THREE.NormalBlending);
    this.sparkSlots = this.makeParticlePool(8, 6, 0xffe9a8, 0.07, 0.16, THREE.AdditiveBlending);
    this.puffSlots = this.makeParticlePool(8, 4, 0x8a8a8a, 0.14, 0.55, THREE.NormalBlending);
    this.particleSlots = [
      ...this.explosionSlots, ...this.impactSlots,
      ...this.smokeSlots, ...this.sparkSlots, ...this.puffSlots,
    ];

    // Kenney particle textures (CC0) float in when available — the procedural
    // soft-circle stays as the instant fallback (offline dev, stripped deploy)
    const texLoader = new THREE.TextureLoader();
    const applyTex = (url: string, mats: (THREE.SpriteMaterial | THREE.PointsMaterial)[]): void => {
      texLoader
        .loadAsync(url)
        .then((t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          for (const m of mats) {
            m.map = t;
            m.needsUpdate = true;
          }
        })
        .catch(() => { /* keep the soft circle */ });
    };
    applyTex('/assets/fx/fireball.png', this.fireballSlots.map((s) => s.sprite.material as THREE.SpriteMaterial));
    applyTex('/assets/fx/muzzle.png', this.muzzleSlots.map((s) => s.sprite.material as THREE.SpriteMaterial));
    applyTex('/assets/fx/smoke.png', this.smokeSlots.map((s) => s.points.material as THREE.PointsMaterial));
  }

  /** Generic pooled Points builder for the small effects. */
  private makeParticlePool(
    slots: number,
    particles: number,
    color: number,
    size: number,
    maxLife: number,
    blending: THREE.Blending,
  ): ExplosionSlot[] {
    const out: ExplosionSlot[] = [];
    for (let i = 0; i < slots; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(particles * 3), 3));
      const mat = new THREE.PointsMaterial({
        map: softCircleTexture(),
        color, size, blending,
        sizeAttenuation: true, transparent: true, depthWrite: false,
        alphaTest: 0.02,
      });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      this.scene.add(points);
      out.push({
        points,
        positions: geo.attributes.position as THREE.BufferAttribute,
        velocities: new Float32Array(particles * 3),
        active: false, life: 0, maxLife, accelY: -9.8,
      });
    }
    return out;
  }

  private initFireballs() {
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({
        map: softCircleTexture(),
        color: 0xff5a1a,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.fireballSlots.push({ sprite, active: false, life: 0 });
    }
  }

  /** Spawn helper: scatter a pooled Points slot at pos with random velocities. */
  private burst(
    pool: ExplosionSlot[], idx: number, pos: THREE.Vector3,
    speedMin: number, speedMax: number, upBias: number, accelY: number, opacity = 1,
  ): number {
    const slot = pool[idx];
    const next = (idx + 1) % pool.length;
    slot.active = true;
    slot.life = slot.maxLife;
    slot.accelY = accelY;
    slot.points.visible = true;
    slot.points.position.copy(pos);
    const posArr = slot.positions.array as Float32Array;
    const velArr = slot.velocities;
    const count = posArr.length / 3;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      posArr[i3] = 0; posArr[i3 + 1] = 0; posArr[i3 + 2] = 0;
      const phi = Math.random() * Math.PI * upBias;
      const theta = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      velArr[i3] = speed * Math.sin(phi) * Math.cos(theta);
      velArr[i3 + 1] = speed * Math.cos(phi);
      velArr[i3 + 2] = speed * Math.sin(phi) * Math.sin(theta);
    }
    // particles are LOCAL to the slot (slot origin = pos) — reset attr each spawn
    slot.positions.needsUpdate = true;
    (slot.points.material as THREE.PointsMaterial).opacity = opacity;
    return next;
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
        map: softCircleTexture(),
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
      this.muzzleSlots.push({ sprite, active: false, life: 0, boost: 1 });
    }
  }

  private initExplosions() {
    const particleCount = 48;
    for (let i = 0; i < this.explosionSize; i++) {
      const positionsArr = new Float32Array(particleCount * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positionsArr, 3));
      const mat = new THREE.PointsMaterial({
        map: softCircleTexture(),
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
        accelY: -9.8,
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
        map: softCircleTexture(),
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
        accelY: -9.8,
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
      posArr[i3] = 0; posArr[i3 + 1] = 0; posArr[i3 + 2] = 0; // local coords
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

  muzzle(pos: THREE.Vector3, boost = 1) {
    const slot = this.muzzleSlots[this.muzzleIdx];
    this.muzzleIdx = (this.muzzleIdx + 1) % this.muzzleSize;
    slot.active = true;
    slot.life = 0.05;
    slot.boost = boost;
    slot.sprite.visible = true;
    slot.sprite.position.copy(pos);
    slot.sprite.scale.set(0.5 * boost, 0.5 * boost, 0.5 * boost);
    (slot.sprite.material as THREE.SpriteMaterial).opacity = 1;

    // muzzle sparks (fast, tiny, hot) + a wisp of smoke drifting up
    this.sparkIdx = this.burst(this.sparkSlots, this.sparkIdx, pos, 2, 7, 1.0, -9.8, 1);
    this.puffIdx = this.burst(this.puffSlots, this.puffIdx, pos, 0.2, 0.9, 0.4, 0.9, 0.4);
  }

  /** Railgun beam — the tracer pool drawn thick: center line plus two
   *  parallels offset ±0.05 m on a stable perpendicular, bigger muzzle. */
  tracerThick(from: THREE.Vector3, to: THREE.Vector3) {
    _dir.subVectors(to, from);
    if (_dir.lengthSq() < 1e-12) {
      this.tracer(from, to);
      return;
    }
    _dir.normalize();
    // any vector not parallel to the beam seeds a stable perpendicular
    _up.set(0, 1, 0);
    if (Math.abs(_dir.y) > 0.9) _up.set(1, 0, 0);
    _perp.crossVectors(_dir, _up).normalize().multiplyScalar(0.05);

    this.tracer(from, to);
    _from.copy(from).add(_perp);
    _to.copy(to).add(_perp);
    this.tracer(_from, _to);
    _from.copy(from).sub(_perp);
    _to.copy(to).sub(_perp);
    this.tracer(_from, _to);
    this.muzzle(from, 1.6);
  }

  /** Standalone smoke puff (drone death tumble etc.) — same pool the
   *  explosion plumes draw from. */
  smoke(pos: THREE.Vector3) {
    this.smokeIdx = this.burst(this.smokeSlots, this.smokeIdx, pos, 0.4, 1.8, 0.6, 1.4, 0.55);
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
    // particles are LOCAL to the slot (points.position carries the world pos —
    // writing world coords here too would double the offset)
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      posArr[i3] = 0;
      posArr[i3 + 1] = 0;
      posArr[i3 + 2] = 0;
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

    // fireball flash: big additive sprite ballooning out
    const fb = this.fireballSlots[this.fireballIdx];
    this.fireballIdx = (this.fireballIdx + 1) % this.fireballSlots.length;
    fb.active = true;
    fb.life = 0.3;
    fb.sprite.visible = true;
    fb.sprite.position.copy(pos);
    fb.sprite.scale.set(1, 1, 1);
    (fb.sprite.material as THREE.SpriteMaterial).opacity = 1;

    // rising smoke plume (buoyant, long-lived)
    this.smokeIdx = this.burst(this.smokeSlots, this.smokeIdx, pos, 0.6, 3.2, 0.45, 1.6, 0.7);
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
        const scale = (0.15 + 0.35 * (slot.life / 0.05)) * slot.boost;
        slot.sprite.scale.set(scale, scale, scale);
        (slot.sprite.material as THREE.SpriteMaterial).opacity = slot.life / 0.05;
      }
    }

    // Fireballs: balloon out fast, fade
    for (const fb of this.fireballSlots) {
      if (!fb.active) continue;
      fb.life -= dt;
      if (fb.life <= 0) {
        fb.active = false;
        fb.sprite.visible = false;
      } else {
        const t = 1 - fb.life / 0.3;                 // 0 → 1
        const scale = 1 + t * 7;                     // 1 m → 8 m across
        fb.sprite.scale.set(scale, scale, scale);
        (fb.sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * (1 - t);
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
          velArr[i3 + 1] += slot.accelY * dt; // gravity or smoke buoyancy
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
