"""Export the static hero trace from one real GRABMyo recording.

Reproduce:
  curl -O https://physionet-open.s3.amazonaws.com/grabmyo/1.1.0/Session1/session1_participant1/session1_participant1_gesture12_trial1.dat
  python research/hero_trace.py session1_participant1_gesture12_trial1.dat > src/data/hero-trace.json

Source: GRABMyo v1.1.0 (CC BY 4.0), doi:10.13026/89dm-f662.
WFDB format 16: little-endian int16, 32 interleaved columns, 2048 Hz.
"""
import json, sys
import numpy as np
from scipy.signal import butter, sosfiltfilt, iirnotch, filtfilt

FS = 2048
PATH = sys.argv[1]
START_S, DUR_S, POINTS = 2.25, 0.75, 360  # a 750 ms slice from the steady part of the hold

x = np.fromfile(PATH, dtype="<i2").reshape(-1, 32).astype(np.float64)
bip = x[:, :8] - x[:, 8:16]  # 8 forearm bipolar pairs: ring 1 (F1-F8) minus ring 2 (F9-F16)
sos = butter(4, [10, 500], "bandpass", fs=FS, output="sos")
y = sosfiltfilt(sos, bip, axis=0)
b, a = iirnotch(60, 30, FS)
y = filtfilt(b, a, y, axis=0)

seg = y[int(START_S * FS): int((START_S + DUR_S) * FS)]
ch = int(np.argmax(np.sqrt((seg ** 2).mean(0))))  # the most active pair
s = seg[:, ch]
# min/max decimation keeps the peaks, so the shape stays honest at low point counts
blocks = np.array_split(s, POINTS // 2)
pts = []
for blk in blocks:
    i, j = int(np.argmin(blk)), int(np.argmax(blk))
    pts += [blk[min(i, j)], blk[max(i, j)]]
pts = np.array(pts)
pts = pts / np.abs(pts).max()

json.dump({
    "source": "GRABMyo v1.1.0, participant 1, day 1, Wrist Flexion (gesture 12), trial 1",
    "channel": f"forearm bipolar pair F{ch + 1}-F{ch + 9}",
    "filter": "10-500 Hz 4th-order Butterworth, 60 Hz notch",
    "window": f"{START_S:.2f}-{START_S + DUR_S:.2f} s, min/max decimated to {len(pts)} points, normalised to peak",
    "license": "CC BY 4.0",
    "doi": "10.13026/89dm-f662",
    "points": [round(float(v), 3) for v in pts],
}, sys.stdout, indent=None)
