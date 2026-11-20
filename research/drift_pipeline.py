"""Cross-day drift in GRABMyo, and what the demo under the hero replays.

For every participant: train a classifier on day 1, test it on day 1 (held-out repetitions), day 8
and day 29, then recalibrate with k = 1, 2, 3 day-29 repetitions. Report mean +- SD over all 43
participants, pick the demo participant by a stated rule, and export what the browser needs.

Reproduce (downloads ~2 GB into DATA, cached; takes a few minutes on 4 cores):
  pip install -r research/requirements.txt
  python research/drift_pipeline.py --data /tmp/grabmyo --out public/demo --report src/data/drift.json

Source: GRABMyo v1.1.0 (Pradhan, He & Jiang, Scientific Data 9:733, 2022), CC BY 4.0,
doi:10.13026/89dm-f662, via the PhysioNet open-data S3 mirror.

Setup, and why:
- Gestures: hand close (16), hand open (15), thumb-index opposition (4), index extension (9): the
  four the demo offers. Sessions 1, 2, 3 are days 1, 8, 29. Seven 5 s trials per gesture per day.
- Signal: the 16 forearm electrodes as 8 bipolar pairs (ring 1 minus ring 2), each file converted
  to mV with its own per-channel gain and baseline from the .hea (raw counts are not comparable
  across files). 10-500 Hz Butterworth band-pass and a 60 Hz notch. The first and last 0.5 s of
  each trial are dropped (onset and release).
- Windows: 200 ms, stepped every 50 ms. 200 ms sits in the 150-250 ms range that real-time
  myoelectric control uses (long enough for stable amplitude features, short enough to respond
  without a noticeable delay); 50 ms gives 20 decisions a second.
- Features (40): log MAV, log RMS, log waveform length, zero crossings, slope sign changes, per pair.
- Classifier: linear discriminant analysis with equal priors on z-scored features (day-1 mean and
  SD) and a shrunk pooled covariance, (1 - lam) S + lam * mean(diag S) * I, with lam from the
  Ledoit-Wolf estimate on day 1 and then held fixed. Written out by hand (not sklearn) so the
  browser can run exactly the same maths, recalibration included.
- Split: train on day-1 trials 1-5; test on day-1 trials 6-7, day-8 trials 4-7, day-29 trials 4-7.
  Recalibration adds day-29 trials 1..k of every gesture to the day-1 training data and refits.
- Demo participant: the one whose day-1 to day-29 drop is closest to the population median, so
  the demo shows a typical case, not the most dramatic one.
"""
import argparse, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import numpy as np
from scipy.signal import butter, sosfiltfilt, iirnotch, filtfilt
from sklearn.covariance import ledoit_wolf_shrinkage

BASE = "https://physionet-open.s3.amazonaws.com/grabmyo/1.1.0"
FS = 2048
WIN, STEP = int(0.2 * FS), int(0.05 * FS)
GESTURES = [(16, "Hand close"), (15, "Hand open"), (4, "Thumb-index pinch"), (9, "Index point")]
DAYS = {1: 1, 2: 8, 3: 29}  # session -> day
TRAIN, TEST1, TEST_LATER, RECAL = [1, 2, 3, 4, 5], [6, 7], [4, 5, 6, 7], [1, 2, 3]
PARTICIPANTS = range(1, 44)
SOS = butter(4, [10, 500], "bandpass", fs=FS, output="sos")
NB, NA = iirnotch(60, 30, FS)


def name(s, p, g, t):
    return f"session{s}_participant{p}_gesture{g}_trial{t}"


def fetch(data, s, p, g, t):
    for ext in ("dat", "hea"):
        path = f"{data}/{name(s, p, g, t)}.{ext}"
        if os.path.exists(path):
            continue
        url = f"{BASE}/Session{s}/session{s}_participant{p}/{name(s, p, g, t)}.{ext}"
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    blob = r.read()
                with open(path + ".part", "wb") as f:
                    f.write(blob)
                os.replace(path + ".part", path)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)


def load(data, s, p, g, t):
    """mV, 8 bipolar forearm pairs, filtered, onset and release trimmed."""
    base = f"{data}/{name(s, p, g, t)}"
    x = np.fromfile(base + ".dat", dtype="<i2").reshape(-1, 32).astype(np.float64)
    lines = open(base + ".hea").read().splitlines()[1:33]
    gb = [re.search(r" 16 ([\d.e+-]+)\((-?\d+)\)/mV", l) for l in lines]
    x = (x - np.array([int(m[2]) for m in gb])) / np.array([float(m[1]) for m in gb])
    bip = x[:, :8] - x[:, 8:16]
    y = filtfilt(NB, NA, sosfiltfilt(SOS, bip, axis=0), axis=0)
    return y[int(0.5 * FS): int(4.5 * FS)]


def features(y):
    out = []
    for i in range(0, len(y) - WIN + 1, STEP):
        w = y[i: i + WIN]
        d = np.diff(w, axis=0)
        th = 0.01 * np.std(w, axis=0)
        mav = np.abs(w).mean(0)
        rms = np.sqrt((w ** 2).mean(0))
        wl = np.abs(d).sum(0)
        zc = ((w[:-1] * w[1:] < 0) & (np.abs(d) > th)).sum(0)
        ssc = (d[:-1] * d[1:] < 0).sum(0)
        out.append(np.concatenate([np.log(mav), np.log(rms), np.log(wl), zc, ssc]))
    return np.array(out)


def trials_needed():
    for s in (1, 2, 3):
        trials = TRAIN + TEST1 if s == 1 else TEST_LATER if s == 2 else sorted(set(TEST_LATER + RECAL))
        for g, _ in GESTURES:
            for t in trials:
                yield s, g, t


def participant_features(args):
    data, cache, p = args
    path = f"{cache}/p{p}.npz"
    if os.path.exists(path):
        return p
    F = {}
    for s, g, t in trials_needed():
        F[f"s{s}_g{g}_t{t}"] = features(load(data, s, p, g, t)).astype(np.float32)
    np.savez_compressed(path, **F)
    return p


# ------------------------------------------------------------------------------------- the model
# Everything the browser needs to refit: per-class counts, sums and sums of outer products of the
# z-scored features. Fitting from these is exact, so adding recalibration windows is just adding.

def stats(X, y, k=len(GESTURES)):
    d = X.shape[1]
    n = np.zeros(k); s = np.zeros((k, d)); m = np.zeros((k, d, d))
    for c in range(k):
        Xc = X[y == c]
        n[c] = len(Xc); s[c] = Xc.sum(0); m[c] = Xc.T @ Xc
    return n, s, m


def fit(n, s, m, lam):
    mu = s / n[:, None]
    S = sum(m[c] - n[c] * np.outer(mu[c], mu[c]) for c in range(len(n))) / n.sum()
    sig = (1 - lam) * S + lam * np.mean(np.diag(S)) * np.eye(len(S))
    W = np.linalg.solve(sig, mu.T).T            # (k, d)
    b = -0.5 * np.einsum("kd,kd->k", W, mu)     # equal priors
    return W, b


def predict(W, b, X):
    return np.argmax(X @ W.T + b, axis=1)


def evaluate(F, p_unused=None):
    def stack(s, trials):
        X, y = [], []
        for c, (g, _) in enumerate(GESTURES):
            for t in trials:
                f = F[f"s{s}_g{g}_t{t}"]; X.append(f); y += [c] * len(f)
        return np.vstack(X), np.array(y)
    Xa, ya = stack(1, TRAIN)
    mean, sd = Xa.mean(0), Xa.std(0) + 1e-9
    z = lambda X: (X - mean) / sd
    Za = z(Xa)
    lam = float(ledoit_wolf_shrinkage(Za - np.stack([Za[ya == c].mean(0) for c in range(len(GESTURES))])[ya]))
    n, s, m = stats(Za, ya)
    W, b = fit(n, s, m, lam)
    acc = lambda X, y: float((predict(W, b, z(X)) == y).mean())
    r = {"day1": acc(*stack(1, TEST1)), "day8": acc(*stack(2, TEST_LATER)), "day29": acc(*stack(3, TEST_LATER))}
    Xt, yt = stack(3, TEST_LATER)
    for k in (1, 2, 3):
        Xk, yk = stack(3, RECAL[:k])
        nk, sk, mk = stats(z(Xk), yk)
        W2, b2 = fit(n + nk, s + sk, m + mk, lam)
        r[f"recal{k}"] = float((predict(W2, b2, z(Xt)) == yt).mean())
    return r, dict(mean=mean, sd=sd, lam=lam, n=n, s=s, m=m, W=W, b=b)


# --------------------------------------------------------------------------------- demo assets

def display_trace(y, points=480):
    """Min/max-decimated trace of the most active pair, and a 100 Hz RMS envelope of all pairs."""
    ch = int(np.argmax(np.sqrt((y ** 2).mean(0))))
    blocks = np.array_split(y[:, ch], points // 2)
    tr = []
    for blk in blocks:
        i, j = int(np.argmin(blk)), int(np.argmax(blk))
        tr += [blk[min(i, j)], blk[max(i, j)]]
    hop = FS // 100
    env = np.sqrt((y ** 2).mean(1))
    env = np.array([env[i: i + hop].mean() for i in range(0, len(env) - hop + 1, hop)])
    return ch, np.array(tr), env


def f16(a):
    return np.asarray(a, dtype="<f2").tobytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="/tmp/grabmyo")
    ap.add_argument("--out", default="public/demo")
    ap.add_argument("--report", default="src/data/drift.json")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    a = ap.parse_args()
    os.makedirs(a.data, exist_ok=True)
    cache = f"{a.data}/features"; os.makedirs(cache, exist_ok=True)

    jobs = [(a.data, s, p, g, t) for p in PARTICIPANTS for s, g, t in trials_needed()]
    print(f"fetching {len(jobs)} trials (cached ones are skipped)", file=sys.stderr)
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda j: fetch(*j), jobs))
    with ProcessPoolExecutor(a.workers) as ex:
        for p in ex.map(participant_features, [(a.data, cache, p) for p in PARTICIPANTS]):
            print(f"features: participant {p}", file=sys.stderr)

    per = {}
    for p in PARTICIPANTS:
        F = dict(np.load(f"{cache}/p{p}.npz"))
        per[p], _ = evaluate(F)
        print(p, {k: round(v, 3) for k, v in per[p].items()}, file=sys.stderr)
    keys = ["day1", "day8", "day29", "recal1", "recal2", "recal3"]
    R = np.array([[per[p][k] for k in keys] for p in PARTICIPANTS])
    drop = R[:, 0] - R[:, 2]
    summary = {k: {"mean": float(R[:, i].mean()), "sd": float(R[:, i].std(ddof=1)), "median": float(np.median(R[:, i]))}
               for i, k in enumerate(keys)}
    summary["drop"] = {"mean": float(drop.mean()), "sd": float(drop.std(ddof=1)), "median": float(np.median(drop)),
                       "participantsWithDrop": int((drop > 0).sum())}
    demo_p = int(list(PARTICIPANTS)[int(np.argmin(np.abs(drop - np.median(drop))))])

    # ---- demo assets for the chosen participant
    F = dict(np.load(f"{cache}/p{demo_p}.npz"))
    res, M = evaluate(F)
    z = lambda X: (X - M["mean"]) / M["sd"]
    clips, blob, off = [], bytearray(), 0

    def add(arr):
        nonlocal off
        b = f16(arr); blob.extend(b); start = off; off += len(b)
        return {"offset": start, "length": int(np.asarray(arr).size)}

    for c, (g, label) in enumerate(GESTURES):
        # Day-1 trial 6 and day-29 trial 4 are what a hold replays; both are also test trials.
        for s, t, role in [(1, 6, "play+test"), (1, 7, "test"), (3, 4, "play+test"),
                           *[(3, t, "test") for t in TEST_LATER[1:]], *[(3, t, "recal") for t in RECAL]]:
            Z = z(F[f"s{s}_g{g}_t{t}"])
            clip = {"gesture": c, "day": DAYS[s], "trial": t, "role": role, "windows": len(Z), "features": add(Z)}
            if role == "play+test":
                ch, tr, env = display_trace(load(a.data, s, demo_p, g, t))
                clip["trace"] = {"pair": f"F{ch + 1}-F{ch + 9}", **add(tr / 0.05)}   # in units of 50 uV
                clip["envelope"] = {"hz": 100, **add(env / 0.05)}
            clips.append(clip)
    os.makedirs(a.out, exist_ok=True)
    # Day-1 training statistics, exact (float64 in JSON): per-class count and mean, and the pooled
    # within-class scatter. Adding windows merges exactly (Chan et al.), so the browser's refit is
    # the same as refitting here.
    n, mu = M["n"], M["s"] / M["n"][:, None]
    scatter = sum(M["m"][c] - n[c] * np.outer(mu[c], mu[c]) for c in range(len(n)))
    iu = np.triu_indices(len(scatter))
    g6 = lambda v: [float(f"{x:.7g}") for x in np.ravel(v)]
    model = {"lambda": M["lam"], "n": n.tolist(), "mean": [g6(r) for r in mu], "scatterUpper": g6(scatter[iu]),
             "zMean": g6(M["mean"]), "zSd": g6(M["sd"])}
    # The demo's map: the two directions that best separate the gestures on day 1 (the leading
    # discriminant axes, eigenvectors of Sw^-1 Sb with the model's shrunk Sw), fixed from then on,
    # so a day-29 window lands wherever the day-1 view puts it and drift shows as movement.
    Sw = scatter / n.sum()
    Sw = (1 - M["lam"]) * Sw + M["lam"] * np.mean(np.diag(Sw)) * np.eye(len(Sw))
    origin = mu.mean(0)
    Sb = sum(n[c] * np.outer(mu[c] - origin, mu[c] - origin) for c in range(len(n))) / n.sum()
    ev, V = np.linalg.eig(np.linalg.solve(Sw, Sb))
    V = V[:, np.argsort(-ev.real)[:2]].real
    V /= np.sqrt(np.einsum("di,de,ei->i", V, Sw, V))   # unit within-class SD along each axis
    P = (mu - origin) @ V
    V *= np.sign([P[0, 0], P[1, 1]])                   # hand close to the right, hand open up
    model["map"] = {"origin": g6(origin), "axes": [g6(V[:, 0]), g6(V[:, 1])]}
    open(f"{a.out}/emg.bin", "wb").write(bytes(blob))
    meta = {
        "source": "GRABMyo v1.1.0 (Pradhan, He & Jiang, Scientific Data 9:733, 2022)",
        "doi": "10.13026/89dm-f662", "license": "CC BY 4.0",
        "participant": demo_p,
        "selection": "participant whose day-1 to day-29 drop is closest to the median of all 43",
        "gestures": [{"id": g, "label": l} for g, l in GESTURES],
        "windowing": {"lengthMs": 200, "stepMs": 50, "trimS": 0.5},
        "filter": "10-500 Hz 4th-order Butterworth band-pass, 60 Hz notch, 8 bipolar forearm pairs",
        "features": ["log MAV", "log RMS", "log WL", "ZC", "SSC"], "featureCount": 40,
        "featuresAreZScored": True,
        "model": model,
        "accuracy": res,
        "clips": clips,
        "binary": {"file": "emg.bin", "dtype": "float16, little-endian", "bytes": len(blob)},
    }
    json.dump(meta, open(f"{a.out}/emg.json", "w"), separators=(",", ":"))
    report = {"measuredAt": time.strftime("%Y-%m-%d"), "participants": len(R), "gestures": [l for _, l in GESTURES],
              "summary": summary, "perParticipant": {str(p): {k: round(v, 4) for k, v in per[p].items()} for p in per},
              "demoParticipant": demo_p, "demoAccuracy": res, "method": __doc__.split("Setup, and why:")[1].strip()}
    os.makedirs(os.path.dirname(a.report), exist_ok=True)
    json.dump(report, open(a.report, "w"), indent=1)
    print(json.dumps({"summary": summary, "demo": demo_p, "demoAccuracy": res, "binBytes": len(blob)}, indent=1))


if __name__ == "__main__":
    main()
