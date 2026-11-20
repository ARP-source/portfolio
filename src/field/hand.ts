/**
 * A procedural right hand for the hero: 16 bones (wrist and palm, three per finger and thumb),
 * capsule fingers, a rounded-box palm. Particles are sampled once on the surface in bone-local
 * space; each frame the CPU poses the skeleton (forward kinematics, a few dozen matrix products)
 * and the GPU skins the samples with the 16 bone matrices. Units: palm width is about 0.9.
 *
 * The gestures are the four from the GRABMyo protocol the demo uses, plus a relaxed pose.
 */

export const BONES = 16;

type Finger = 'index' | 'middle' | 'ring' | 'pinky';
const FINGERS: Finger[] = ['index', 'middle', 'ring', 'pinky'];

/** [mcp, pip, dip] flexion in degrees (positive curls toward the palm), and side-spread. */
interface FingerPose { flex: [number, number, number]; spread: number }
interface ThumbPose { abd: number; opp: number; flex: [number, number, number] }
export interface Pose { fingers: Record<Finger, FingerPose>; thumb: ThumbPose; wrist: number }

const f = (a: number, b: number, c: number, spread = 0): FingerPose => ({ flex: [a, b, c], spread });

export const POSES: Record<'relaxed' | 'open' | 'close' | 'pinch' | 'point', Pose> = {
  // The reference photo: index up, thumb out, the other three curling progressively.
  relaxed: {
    fingers: { index: f(6, 8, 4, 7), middle: f(22, 42, 24, 1), ring: f(38, 58, 34, -3), pinky: f(48, 62, 36, -9) },
    thumb: { abd: 38, opp: 14, flex: [4, 10, 12] },
    wrist: 0,
  },
  open: {
    fingers: { index: f(0, 2, 2, 9), middle: f(0, 2, 2, 2), ring: f(0, 2, 2, -4), pinky: f(0, 2, 2, -12) },
    thumb: { abd: 46, opp: 0, flex: [0, 0, 0] },
    wrist: -4,
  },
  close: {
    fingers: { index: f(82, 98, 58, 0), middle: f(84, 100, 60, 0), ring: f(84, 100, 60, 0), pinky: f(82, 96, 58, -2) },
    thumb: { abd: 18, opp: 58, flex: [18, 36, 30] },
    wrist: 6,
  },
  // Thumb-index opposition.
  pinch: {
    fingers: { index: f(42, 52, 30, 2), middle: f(16, 24, 14, 1), ring: f(22, 30, 18, -3), pinky: f(28, 36, 22, -9) },
    thumb: { abd: 30, opp: 62, flex: [10, 26, 22] },
    wrist: 2,
  },
  // Index extension.
  point: {
    fingers: { index: f(0, 0, 0, 3), middle: f(82, 98, 58, 0), ring: f(84, 100, 60, 0), pinky: f(82, 96, 58, -2) },
    thumb: { abd: 22, opp: 52, flex: [16, 30, 26] },
    wrist: 0,
  },
};

/** The order the hero cycles through; it starts and rests on the reference pose. */
export const SEQUENCE: (keyof typeof POSES)[] = ['relaxed', 'close', 'open', 'pinch', 'point'];

// Rest skeleton. Bone 0 is the wrist and palm; fingers are bones 1..12 (three each); thumb 13..15.
const BASE: Record<Finger, [number, number, number]> = {
  index: [-0.33, 0.98, 0],
  middle: [-0.11, 1.02, 0],
  ring: [0.11, 0.98, 0],
  pinky: [0.31, 0.9, 0],
};
const LEN: Record<Finger, [number, number, number]> = {
  index: [0.42, 0.25, 0.2],
  middle: [0.47, 0.29, 0.21],
  ring: [0.44, 0.27, 0.2],
  pinky: [0.34, 0.2, 0.18],
};
const RAD: Record<Finger, number> = { index: 0.1, middle: 0.1, ring: 0.095, pinky: 0.085 };
const THUMB_BASE: [number, number, number] = [-0.4, 0.2, 0.06];
const THUMB_LEN: [number, number, number] = [0.36, 0.3, 0.24];
const THUMB_RAD = 0.115;

// ---------------------------------------------------------------- 4x4 column-major matrices

type M = Float32Array;
const ident = (): M => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul(a: M, b: M, out: M = new Float32Array(16)): M {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return out;
}
const rad = (d: number) => (d * Math.PI) / 180;
function rotX(d: number): M {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d)), m = ident();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}
function rotY(d: number): M {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d)), m = ident();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}
function rotZ(d: number): M {
  const c = Math.cos(rad(d)), s = Math.sin(rad(d)), m = ident();
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}
function trans(x: number, y: number, z: number): M {
  const m = ident();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** Linear blend of two poses (angles), t in 0..1. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => x + (y - x) * t;
  const fingers = {} as Record<Finger, FingerPose>;
  for (const k of FINGERS) {
    const p = a.fingers[k], q = b.fingers[k];
    fingers[k] = { flex: [l(p.flex[0], q.flex[0]), l(p.flex[1], q.flex[1]), l(p.flex[2], q.flex[2])], spread: l(p.spread, q.spread) };
  }
  const ta = a.thumb, tb = b.thumb;
  return {
    fingers,
    thumb: { abd: l(ta.abd, tb.abd), opp: l(ta.opp, tb.opp), flex: [l(ta.flex[0], tb.flex[0]), l(ta.flex[1], tb.flex[1]), l(ta.flex[2], tb.flex[2])] },
    wrist: l(a.wrist, b.wrist),
  };
}

/**
 * Bone matrices for a pose, pre-multiplied by `world` (rotation of the whole hand).
 * `grip` (0..1) adds a little extra flexion everywhere: the hero drives it with the EMG envelope.
 */
export function poseBones(pose: Pose, world: M, grip = 0, out = new Float32Array(BONES * 16)): Float32Array {
  const root = mul(world, rotX(pose.wrist + grip * 6));
  out.set(root, 0);
  FINGERS.forEach((k, fi) => {
    const fp = pose.fingers[k];
    const [bx, by, bz] = BASE[k];
    let m = mul(root, trans(bx, by, bz));
    m = mul(m, rotZ(fp.spread));
    for (let j = 0; j < 3; j++) {
      m = mul(m, rotX(fp.flex[j]! + grip * (j === 0 ? 10 : 14)));
      out.set(m, (1 + fi * 3 + j) * 16);
      m = mul(m, trans(0, LEN[k][j]!, 0));
    }
  });
  const tp = pose.thumb;
  let m = mul(root, trans(...THUMB_BASE));
  m = mul(m, rotZ(tp.abd));
  m = mul(m, rotY(-tp.opp));
  for (let j = 0; j < 3; j++) {
    m = mul(m, rotX(tp.flex[j]! + grip * 8));
    out.set(m, (13 + j) * 16);
    m = mul(m, trans(0, THUMB_LEN[j]!, 0));
  }
  return out;
}

/** World transform: spin about the vertical axis, a slight forward tilt, centred on the palm. */
export function handWorld(spinDeg: number, tiltDeg = 10): M {
  return mul(mul(rotX(tiltDeg), rotY(spinDeg)), trans(0, -0.72, 0));
}

// ---------------------------------------------------------------- surface samples

/** Seeded so a rebuild at another tier keeps the same look. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

interface Part { bone: number; area: number; sample: (r: () => number) => [number, number, number] }

function capsule(bone: number, len: number, r0: number, cap: boolean): Part {
  const taper = 0.82;
  return {
    bone,
    area: 2 * Math.PI * r0 * len + (cap ? 2 * Math.PI * r0 * r0 * taper * taper : 0),
    sample(r) {
      const capShare = cap ? (r0 * taper * 0.5) / (len + r0 * taper * 0.5) : 0;
      const a = r() * Math.PI * 2;
      if (r() < capShare) {
        // Hemisphere at the tip.
        const z = r(), rr = Math.sqrt(1 - z * z) * r0 * taper;
        return [Math.cos(a) * rr, len + z * r0 * taper, Math.sin(a) * rr];
      }
      const t = r();
      const rr = r0 * (1 - (1 - taper) * t);
      return [Math.cos(a) * rr, t * len, Math.sin(a) * rr * 0.9];
    },
  };
}

const PARTS: Part[] = [
  // Palm: a rounded slab, thinner at the fingers' end.
  {
    bone: 0,
    area: 2.3,
    sample(r) {
      const face = r();
      let x = (r() - 0.5) * 0.9, y = r() * 1.0, z: number;
      const th = 0.15 - 0.04 * y;
      if (face < 0.8) {
        z = (r() < 0.5 ? -1 : 1) * th;
        // Round the slab's edges.
        const e = Math.max(Math.abs(x) / 0.45, 0) ** 6;
        z *= 1 - 0.6 * e;
      } else {
        // Sides.
        x = (r() < 0.5 ? -1 : 1) * 0.45;
        z = (r() - 0.5) * 2 * th * 0.7;
      }
      return [x, y, z];
    },
  },
  // Wrist, a short tapering stub below the palm.
  {
    bone: 0,
    area: 0.7,
    sample(r) {
      const a = r() * Math.PI * 2, t = r();
      const rx = 0.3 - 0.04 * t, rz = 0.16;
      return [Math.cos(a) * rx, -t * 0.42, Math.sin(a) * rz];
    },
  },
];
FINGERS.forEach((k, fi) => {
  for (let j = 0; j < 3; j++) PARTS.push(capsule(1 + fi * 3 + j, LEN[k][j]!, RAD[k] * (1 - j * 0.1), j === 2));
});
for (let j = 0; j < 3; j++) PARTS.push(capsule(13 + j, THUMB_LEN[j]!, THUMB_RAD * (1 - j * 0.1), j === 2));

/** n samples as RGBA: xyz in bone space, w = bone index. Area-weighted, so density is even. */
export function sampleHand(n: number, seed = 7): Float32Array {
  const r = rng(seed);
  const total = PARTS.reduce((s, p) => s + p.area, 0);
  const cum: number[] = [];
  let acc = 0;
  for (const p of PARTS) cum.push((acc += p.area / total));
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = r();
    const part = PARTS[cum.findIndex((c) => u <= c)] ?? PARTS[0]!;
    const [x, y, z] = part.sample(r);
    out.set([x, y, z, part.bone], i * 4);
  }
  return out;
}

/** CPU twin of the shader's skinning + projection, for placing particles on the first frame. */
export function projectHand(local: Float32Array, i: number, bones: Float32Array, rect: number[]): [number, number, number] {
  const b = local[i * 4 + 3]! * 16;
  const x = local[i * 4]!, y = local[i * 4 + 1]!, z = local[i * 4 + 2]!;
  const wx = bones[b]! * x + bones[b + 4]! * y + bones[b + 8]! * z + bones[b + 12]!;
  const wy = bones[b + 1]! * x + bones[b + 5]! * y + bones[b + 9]! * z + bones[b + 13]!;
  const wz = bones[b + 2]! * x + bones[b + 6]! * y + bones[b + 10]! * z + bones[b + 14]!;
  const [rx, ry, rw, rh] = rect as [number, number, number, number];
  const scale = Math.min(rh / 2.6, rw / 1.9), persp = HAND_CAM / (HAND_CAM - wz);
  return [rx + rw * 0.5 + wx * scale * persp, ry + rh * 0.5 - wy * scale * persp, wz];
}

/** Camera distance for the hand's perspective, in hand units. Shared with the shader. */
export const HAND_CAM = 5.0;
