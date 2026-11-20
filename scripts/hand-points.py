"""Sample and rig the hero hand: public/hand.bin + src/field/hand-rig.json.

Usage: python3 scripts/hand-points.py path/to/hand.obj
1. Area-weighted random points on the mesh, centred, scaled so y spans -1..1, random order.
2. A 16-bone rig fitted to this sculpt (a left hand, palm facing -z, fingers up and to the left,
   thumb toward -z on the right): each finger's joints are centroids of its points at fixed
   fractions of its length, found from hand-placed 2D guides (front view, base -> tip).
3. Skinning: each point is assigned to the nearest finger segment (or the palm), blending with
   the parent bone near the joint so the surface bends instead of cracking.
hand.bin: float32 scale, then per point int16 x, y, z (value / 32767 * scale) and int16 w =
bone * 256 + round(parent weight * 255). The 40 MB source mesh is not in the repo.
"""
import json
import sys
import numpy as np

N = 8192
V, F = [], []
with open(sys.argv[1]) as fh:
    for line in fh:
        if line.startswith('v '):
            V.append(line.split()[1:4])
        elif line.startswith('f '):
            idx = [int(t.split('/')[0]) for t in line.split()[1:]]
            F.append(idx[:4] if len(idx) >= 4 else idx + [idx[2]])
V = np.array(V, float)
F = np.array(F) - 1
T = np.concatenate([F[:, [0, 1, 2]], F[:, [0, 2, 3]]])
a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
rng = np.random.default_rng(7)
i = rng.choice(len(T), N, p=area / area.sum())
r1, r2 = np.sqrt(rng.random(N)), rng.random(N)
P = (1 - r1)[:, None] * a[i] + (r1 * (1 - r2))[:, None] * b[i] + (r1 * r2)[:, None] * c[i]
P -= (P.min(0) + P.max(0)) / 2
P /= (P[:, 1].max() - P[:, 1].min()) / 2

# Front-view guides (x, y): base knuckle -> tip, and the fractions where the joints sit.
GUIDES = {
    'index': ((0.12, 0.33), (-0.05, 0.95)),
    'middle': ((-0.13, 0.25), (-0.52, 0.80)),
    'ring': ((-0.24, 0.05), (-0.67, 0.43)),
    'pinky': ((-0.30, -0.10), (-0.70, 0.17)),
    'thumb': ((0.42, 0.02), (0.50, 0.67)),
}
FRACS = {'thumb': (0.0, 0.35, 0.68, 1.0)}
DEFAULT_FRACS = (0.0, 0.45, 0.72, 1.0)
WIDTH = {'thumb': 0.13}

joints = {}
for name, (g0, g1) in GUIDES.items():
    g0, g1 = np.array(g0), np.array(g1)
    d = g1 - g0
    L = np.linalg.norm(d)
    u = d / L
    q = P[:, :2] - g0
    t = q @ u
    perp = np.abs(q[:, 0] * u[1] - q[:, 1] * u[0])
    m = (perp < WIDTH.get(name, 0.1)) & (t > -0.05) & (t < L * 1.08)
    pts = []
    for f in FRACS.get(name, DEFAULT_FRACS):
        sel = m & (np.abs(t - f * L) < 0.06)
        pts.append(P[sel].mean(0))
    joints[name] = np.array(pts)

palm_centre = P[(np.abs(P[:, 0] - 0.1) < 0.25) & (np.abs(P[:, 1] + 0.15) < 0.25)].mean(0)
normal = np.array([0.0, 0.0, -1.0])  # palm faces -z

FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb']
bones = []  # (joint, axis, spread axis) per bone 1..15
seg = []    # (bone, p0, p1, radius)
for fi, name in enumerate(FINGERS):
    J = joints[name]
    for k in range(3):
        d = J[k + 1] - J[k]
        d /= np.linalg.norm(d)
        if name == 'thumb':
            towards = palm_centre - J[k]
            towards -= d * (towards @ d)
            n = towards / np.linalg.norm(towards)
        else:
            n = normal
        axis = np.cross(d, n)
        axis /= np.linalg.norm(axis)
        bones.append({'joint': J[k].round(4).tolist(), 'axis': axis.round(4).tolist(), 'spread': n.round(4).tolist()})
        seg.append((1 + fi * 3 + k, J[k], J[k + 1], 0.12 if name == 'thumb' else 0.1))

def seg_dist(p, p0, p1):
    d = p1 - p0
    t = np.clip(((p - p0) @ d) / (d @ d), 0, 1)
    return np.linalg.norm(p - (p0 + t[:, None] * d), axis=1), t

D = np.full((N, len(seg)), 9.0)
TT = np.zeros((N, len(seg)))
for s, (bone, p0, p1, r) in enumerate(seg):
    D[:, s], TT[:, s] = seg_dist(P, p0, p1)
best = D.argmin(1)
dmin = D[np.arange(N), best]
tbest = TT[np.arange(N), best]
bone_of = np.array([seg[s][0] for s in best])
# Points far from every finger axis belong to the palm; the first bit of each proximal
# segment also stays with the palm, so knuckles don't tear away from it.
radius = np.array([seg[s][3] for s in best]) * 1.6
palm = (dmin > radius) | ((bone_of - 1) % 3 == 0) & (tbest < 0.02)
bone_of[palm] = 0
seg_len = np.array([np.linalg.norm(seg[s][2] - seg[s][1]) for s in best])
along = tbest * seg_len
blend = np.where(palm, 0.0, np.clip(0.5 - along / 0.08, 0.0, 0.5))

scale = np.abs(P).max()
q = np.clip(np.round(P / scale * 32767), -32767, 32767).astype('<i2')
w = (bone_of * 256 + np.round(blend * 255)).astype('<i2')
with open('public/hand.bin', 'wb') as out:
    out.write(np.array([scale], '<f4').tobytes())
    out.write(np.concatenate([q, w[:, None]], axis=1).astype('<i2').tobytes())
with open('src/field/hand-rig.json', 'w') as out:
    json.dump({'bones': bones, 'palm': palm_centre.round(4).tolist()}, out, indent=1)
print(N, 'points; per bone:', np.bincount(bone_of, minlength=16).tolist())
