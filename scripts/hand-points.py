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

# Skinning. Each finger's knuckle joint is pushed back toward the wrist (the sculpt's finger
# skin starts below the visible knuckle), then every point near a finger is bound to the last
# joint it lies beyond along the finger, blending smoothly with the bone before it over +-0.05
# around each joint, so bends stretch the surface instead of tearing it or leaving stubs.
KNUCKLE_BACK = 0.1
BLEND = 0.05
best_f = np.full(N, -1)
best_d = np.full(N, 9.0)
for fi, name in enumerate(FINGERS):
    J = joints[name].copy()
    d0 = (J[1] - J[0]) / np.linalg.norm(J[1] - J[0])
    J[0] = J[0] - d0 * KNUCKLE_BACK
    joints[name] = J
    # Distance to the finger's polyline, counting only points past the moved knuckle.
    dist = np.full(N, 9.0)
    for k in range(3):
        a, b = J[k], J[k + 1]
        dv = b - a
        t = np.clip(((P - a) @ dv) / (dv @ dv), 0, 1)
        dist = np.minimum(dist, np.linalg.norm(P - (a + t[:, None] * dv), axis=1))
    past = (P - J[0]) @ d0 > -BLEND
    r = 0.13 if name == 'thumb' else 0.12
    take = past & (dist < r * 1.5) & (dist < best_d)
    best_f[take] = fi
    best_d[take] = dist[take]

# Rebuild bone records with the moved knuckles.
bones = []
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

def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)

bone_of = np.zeros(N, int)
blend = np.zeros(N)
for fi, name in enumerate(FINGERS):
    J = joints[name]
    sel = best_f == fi
    for k in range(3):
        dk = (J[k + 1] - J[k]) / np.linalg.norm(J[k + 1] - J[k])
        s_k = (P[sel] - J[k]) @ dk
        beyond = s_k > -BLEND
        idx = np.where(sel)[0][beyond]
        bone_of[idx] = 1 + fi * 3 + k
        blend[idx] = 1 - smooth((s_k[beyond] + BLEND) / (2 * BLEND))
blend = np.clip(blend, 0, 1)

scale = np.abs(P).max()
q = np.clip(np.round(P / scale * 32767), -32767, 32767).astype('<i2')
w = (bone_of * 256 + np.round(blend * 255)).astype('<i2')  # blend = parent weight
with open('public/hand.bin', 'wb') as out:
    out.write(np.array([scale], '<f4').tobytes())
    out.write(np.concatenate([q, w[:, None]], axis=1).astype('<i2').tobytes())
with open('src/field/hand-rig.json', 'w') as out:
    json.dump({'bones': bones, 'palm': palm_centre.round(4).tolist()}, out, indent=1)
print(N, 'points; per bone:', np.bincount(bone_of, minlength=16).tolist())
