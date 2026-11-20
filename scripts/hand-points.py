"""Sample the hero hand's surface into public/hand.bin.

Usage: python3 scripts/hand-points.py path/to/hand.obj
Area-weighted random points on the mesh (triangles and quads), centred, scaled so y spans
-1..1, in random order (so any prefix is an even subsample). Output: little-endian int16
x, y, z per point, value / 32767 = coordinate. The 40 MB source mesh is not in the repo.
"""
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
q = np.clip(np.round(P / np.abs(P).max() * 32767), -32767, 32767).astype('<i2')
# Store the scale so the loader can undo the normalisation to |max| = 1.
scale = np.array([np.abs(P).max()], '<f4')
with open('public/hand.bin', 'wb') as out:
    out.write(scale.tobytes())
    out.write(q.tobytes())
print(N, 'points, extent', P.min(0).round(3), P.max(0).round(3))
