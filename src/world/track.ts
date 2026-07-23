import * as THREE from 'three';

/** Data-driven track definition. Gate 0 is the start/finish gate; gates must be
 *  crossed in order, each through its front face (+normal = local −Z rotated by yawDeg). */
export interface GateDef {
  pos: [number, number, number];   // gate center (y = center height)
  yawDeg: number;                  // heading of the gate normal (0 = facing −Z)
  size: { w: number; h: number };  // opening width/height, m
  kind?: 'square' | 'flag';
}

export interface Decoration {
  type: 'cone' | 'ramp';
  pos: [number, number, number];
  yawDeg?: number;
  scale?: number;
}

export interface TrackDef {
  name: string;
  spawn: { pos: [number, number, number]; yawDeg: number };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  gates: GateDef[];
  sectorEnds: number[];            // gate indices that close sectors, e.g. [4, 9, 13]
  decorations?: Decoration[];
}

/** Precomputed gate frame for fast crossing tests. */
export interface GateFrame {
  center: THREE.Vector3;
  normal: THREE.Vector3;   // "forward through the gate" direction
  right: THREE.Vector3;    // gate-local +X (half-width axis)
  up: THREE.Vector3;       // gate-local +Y (half-height axis)
  halfW: number;
  halfH: number;
}

/** Gate yawDeg=0 faces −Z (drone flying toward −Z passes it frontally). */
export function gateFrame(g: GateDef): GateFrame {
  const yaw = (g.yawDeg * Math.PI) / 180;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return {
    center: new THREE.Vector3(...g.pos),
    normal: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    up: new THREE.Vector3(0, 1, 0),
    halfW: g.size.w / 2,
    halfH: g.size.h / 2,
  };
}

const _d = new THREE.Vector3();
const _rel = new THREE.Vector3();

/** Swept, directional gate-pass test: does the segment prev→curr cross the gate plane
 *  in the +normal direction with the intersection inside the opening?
 *  Segment-based → frame-rate independent, no tunneling at any speed. */
export function gateCrossing(frame: GateFrame, prev: THREE.Vector3, curr: THREE.Vector3): boolean {
  _d.subVectors(curr, prev);
  const dirDot = _d.dot(frame.normal);
  if (dirDot <= 0) return false;                        // moving backward / parallel → no pass
  const dPrev = _rel.subVectors(prev, frame.center).dot(frame.normal);
  const dCurr = _rel.subVectors(curr, frame.center).dot(frame.normal);
  if (dPrev > 0 || dCurr <= 0) return false;            // must go from behind to in front
  const t = dPrev / (dPrev - dCurr);                    // segment–plane intersection
  _rel.copy(_d).multiplyScalar(t).add(prev).sub(frame.center);
  return Math.abs(_rel.dot(frame.right)) <= frame.halfW && Math.abs(_rel.dot(frame.up)) <= frame.halfH;
}

/** Axis-aligned out-of-bounds check. */
export function outOfBounds(t: TrackDef, p: THREE.Vector3): boolean {
  const { min, max } = t.bounds;
  return p.x < min[0] || p.y < min[1] || p.z < min[2] || p.x > max[0] || p.y > max[1] || p.z > max[2];
}
