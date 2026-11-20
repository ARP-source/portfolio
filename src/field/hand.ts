/**
 * The hero hand: dots sampled from Raag's sculpted hand mesh and bound to a 16-bone skeleton
 * fitted to it (scripts/hand-points.py writes public/hand.bin and hand-rig.json). Each frame the
 * CPU poses the skeleton (a few dozen small matrix products) and the GPU skins the dots.
 * Model space: y spans -1..1; it is a left hand with the palm facing -z.
 *
 * Gestures are angle offsets from the sculpted pose, which is a relaxed, half-open hand.
 */
import rig from './hand-rig.json';

export const HAND_URL = '/hand.bin';
export const BONES = 16;
/** Camera distance for the hand's perspective, in hand units. Shared with the shader. */
export const HAND_CAM = 5.0;

/** Per finger (index, middle, ring, pinky, thumb): [base, middle, tip] flexion and base spread, degrees. */
export type Pose = [number, number, number, number][];
const fist: [number, number, number, number] = [80, 95, 60, 0];
export const POSES: Record<'rest' | 'close' | 'open' | 'pinch' | 'point', Pose> = {
  rest: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  close: [fist, fist, fist, fist, [25, 35, 30, 0]],
  open: [[-12, -5, 0, -6], [-12, -5, 0, 0], [-12, -5, 0, 5], [-12, -5, 0, 10], [-15, -5, 0, 0]],
  // Thumb-index opposition.
  pinch: [[40, 45, 30, 0], [10, 15, 10, 0], [12, 18, 12, 0], [15, 20, 12, 0], [30, 30, 25, 0]],
  // Index extension.
  point: [[-5, 0, 0, 0], fist, fist, fist, [25, 35, 30, 0]],
};
/** The four GRABMyo gestures the demo uses, starting from the sculpted pose. */
export const SEQUENCE: (keyof typeof POSES)[] = ['rest', 'close', 'open', 'pinch', 'point'];

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return a.map((f, i) => f.map((v, k) => v + (b[i]![k]! - v) * t)) as Pose;
}

export interface HandData {
  /** xyz per point, model space. */
  xyz: Float32Array;
  /** Packed skin per point: bone * 256 + parent weight * 255. */
  skin: Float32Array;
}

/** Fetch and decode: float32 scale, then int16 x, y, z, skin per point. */
export async function loadHand(url = HAND_URL): Promise<HandData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`hand points: ${res.status}`);
  const buf = await res.arrayBuffer();
  const scale = new DataView(buf).getFloat32(0, true);
  const q = new Int16Array(buf, 4);
  const m = q.length / 4;
  const xyz = new Float32Array(m * 3), skin = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    xyz[i * 3] = (q[i * 4]! / 32767) * scale;
    xyz[i * 3 + 1] = (q[i * 4 + 1]! / 32767) * scale;
    xyz[i * 3 + 2] = (q[i * 4 + 2]! / 32767) * scale;
    skin[i] = q[i * 4 + 3]!;
  }
  return { xyz, skin };
}

// ---------------------------------------------------------------- 4x4 column-major matrices

type M = Float32Array<ArrayBuffer>;
const ident = (): M => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul(a: Float32Array, b: Float32Array, out: M = new Float32Array(16)): M {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return out;
}
/** Rotation by `deg` about `axis` (unit) through point `j`. */
function about(j: number[], axis: number[], deg: number): M {
  const [x, y, z] = axis as [number, number, number];
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  const m = ident();
  m[0] = c + x * x * k; m[1] = y * x * k + z * s; m[2] = z * x * k - y * s;
  m[4] = x * y * k - z * s; m[5] = c + y * y * k; m[6] = z * y * k + x * s;
  m[8] = x * z * k + y * s; m[9] = y * z * k - x * s; m[10] = c + z * z * k;
  // Translation so the rotation pivots on the joint: j - R j.
  m[12] = j[0]! - (m[0] * j[0]! + m[4] * j[1]! + m[8] * j[2]!);
  m[13] = j[1]! - (m[1] * j[0]! + m[5] * j[1]! + m[9] * j[2]!);
  m[14] = j[2]! - (m[2] * j[0]! + m[6] * j[1]! + m[10] * j[2]!);
  return m;
}

/** Column-major 4x4: tilt about x, then spin about y. */
export function handWorld(spinDeg: number, tiltDeg = 8, out: M = new Float32Array(16)): M {
  const s = (spinDeg * Math.PI) / 180, t = (tiltDeg * Math.PI) / 180;
  const cs = Math.cos(s), ss = Math.sin(s), ct = Math.cos(t), st = Math.sin(t);
  out.set([cs, st * ss, -ct * ss, 0, 0, ct, st, 0, ss, -st * cs, ct * cs, 0, 0, 0, 0, 1]);
  return out;
}

/**
 * The 16 skinning matrices (world x pose) for a pose. `grip` (0..1) adds a little flexion to
 * every finger; the hero drives it with the EMG envelope.
 */
export function poseBones(pose: Pose, world: Float32Array, grip = 0, out = new Float32Array(BONES * 16)): Float32Array<ArrayBuffer> {
  out.set(world, 0);
  for (let f = 0; f < 5; f++) {
    let m: M = new Float32Array(world);
    const fp = pose[f]!;
    for (let k = 0; k < 3; k++) {
      const b = rig.bones[f * 3 + k]!;
      if (k === 0 && fp[3]) m = mul(m, about(b.joint, b.spread, fp[3]));
      m = mul(m, about(b.joint, b.axis, fp[k]! + grip * (k === 0 ? 8 : 12)));
      out.set(m, (1 + f * 3 + k) * 16);
    }
  }
  return out as Float32Array<ArrayBuffer>;
}

const parentOf = (b: number) => (b === 0 || (b - 1) % 3 === 0 ? 0 : b - 1);

/** CPU twin of the shader's skinning + projection, for placing particles on the first frame. */
export function projectHand(x: number, y: number, z: number, skin: number, bones: Float32Array, rect: number[]): [number, number, number] {
  const b = Math.floor(skin / 256), bl = (skin % 256) / 255, pb = parentOf(b);
  const tf = (o: number, r: number) => bones[o + r]! * x + bones[o + 4 + r]! * y + bones[o + 8 + r]! * z + bones[o + 12 + r]!;
  const w = [0, 1, 2].map((r) => (1 - bl) * tf(b * 16, r) + bl * tf(pb * 16, r)) as [number, number, number];
  const [rx, ry, rw, rh] = rect as [number, number, number, number];
  const scale = Math.min(rh / 2.2, rw / 1.9), persp = HAND_CAM / (HAND_CAM - w[2]);
  return [rx + rw * 0.5 + w[0] * scale * persp, ry + rh * 0.5 - w[1] * scale * persp, w[2]];
}
