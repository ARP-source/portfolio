/**
 * The hero hand: a point cloud sampled from a sculpted hand mesh (scripts/hand-points.py writes
 * public/hand.bin), loaded after the field starts. Each frame the CPU builds one matrix (a slow
 * turn about the vertical axis and a slight tilt) and the GPU projects the points with it.
 * Coordinates: y spans -1..1, x about +-0.72, z about +-0.53.
 */

export const HAND_URL = '/hand.bin';
/** Camera distance for the hand's perspective, in hand units. Shared with the shader. */
export const HAND_CAM = 5.0;

/** Fetch and decode the point cloud: a float32 scale, then int16 x, y, z per point. */
export async function loadHand(url = HAND_URL): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`hand points: ${res.status}`);
  const buf = await res.arrayBuffer();
  const scale = new DataView(buf).getFloat32(0, true);
  const q = new Int16Array(buf, 4);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = (q[i]! / 32767) * scale;
  return out;
}

/**
 * Per-particle sample as RGBA (xyz, w unused): particle i takes point i modulo the cloud,
 * so every tier gets an even subsample (the file is stored in random order).
 */
export function handSamples(points: Float32Array, n: number): Float32Array {
  const m = points.length / 3;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const j = (i % m) * 3;
    out[i * 4] = points[j]!;
    out[i * 4 + 1] = points[j + 1]!;
    out[i * 4 + 2] = points[j + 2]!;
  }
  return out;
}

/** Column-major 4x4: tilt about x, then spin about y. */
export function handWorld(spinDeg: number, tiltDeg = 8, out: Float32Array<ArrayBuffer> = new Float32Array(16)): Float32Array<ArrayBuffer> {
  const s = (spinDeg * Math.PI) / 180, t = (tiltDeg * Math.PI) / 180;
  const cs = Math.cos(s), ss = Math.sin(s), ct = Math.cos(t), st = Math.sin(t);
  // Rx(t) * Ry(s)
  out.set([cs, st * ss, -ct * ss, 0, 0, ct, st, 0, ss, -st * cs, ct * cs, 0, 0, 0, 0, 1]);
  return out;
}

/** CPU twin of the shader's projection, for placing particles on the first frame. */
export function projectHand(local: Float32Array, i: number, m: Float32Array, rect: number[]): [number, number, number] {
  const x = local[i * 4]!, y = local[i * 4 + 1]!, z = local[i * 4 + 2]!;
  const wx = m[0]! * x + m[4]! * y + m[8]! * z;
  const wy = m[1]! * x + m[5]! * y + m[9]! * z;
  const wz = m[2]! * x + m[6]! * y + m[10]! * z;
  const [rx, ry, rw, rh] = rect as [number, number, number, number];
  const scale = Math.min(rh / 2.2, rw / 1.9), persp = HAND_CAM / (HAND_CAM - wz);
  return [rx + rw * 0.5 + wx * scale * persp, ry + rh * 0.5 - wy * scale * persp, wz];
}
