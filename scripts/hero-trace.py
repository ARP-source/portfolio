"""
Build src/data/hero-trace.json: one real GRABMyo clip per gesture the hero hand performs.

  python3 -I scripts/hero-trace.py [cache_dir]

Downloads the five trials (and their WFDB headers) from the PhysioNet open-data mirror on S3 into
cache_dir (default .cache/grabmyo). Every clip comes from the same participant, day, window and
electrode pair, and all five share one amplitude scale, so the differences between them are the
recording's, not the processing's. Each gesture was recorded 7 times; the clip is the trial whose
RMS in the window is the median of the 7, so no clip is a best or worst case.

GRABMyo stores each record scaled to fill int16, with a separate gain and baseline per channel and
per file. Raw counts are therefore not comparable between channels or files: convert to volts with
the header first.
"""
import json, os, re, sys, urllib.request
import numpy as np
from scipy.signal import butter, filtfilt, iirnotch, sosfiltfilt

MIRROR = 'https://physionet-open.s3.amazonaws.com/grabmyo/1.1.0'
FS = 2048
SESSION, PARTICIPANT, TRIALS = 1, 1, range(1, 8)
WINDOW = (2.25, 3.00)  # seconds into the trial; the gesture is already held by then
PAIR = (6, 14)  # bipolar forearm pair F6 - F14 (ring 1 minus ring 2), the most active for these gestures
POINTS = 360
# Same order as SEQUENCE in src/field/hand.ts. Gesture numbers are from MotionSequence.txt.
GESTURES = [
    ('rest', 17, 'Rest'),
    ('close', 16, 'Hand close'),
    ('open', 15, 'Hand open'),
    ('pinch', 4, 'Thumb and index opposition'),
    ('point', 9, 'Index extension'),
]


def fetch(cache, name):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        url = f'{MIRROR}/Session{SESSION}/session{SESSION}_participant{PARTICIPANT}/{name}'
        with urllib.request.urlopen(url) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def load_uv(cache, gesture, trial):
    """All 32 channels in microvolts, using each channel's gain and baseline from the header."""
    stem = f'session{SESSION}_participant{PARTICIPANT}_gesture{gesture}_trial{trial}'
    lines = open(fetch(cache, stem + '.hea')).read().splitlines()
    nch = int(lines[0].split()[1])
    gain, base, names = [], [], []
    for line in lines[1 : 1 + nch]:
        m = re.search(r' 16 ([\d.e+-]+)\((-?\d+)\)/mV .* (\S+)$', line)
        gain.append(float(m[1]))
        base.append(int(m[2]))
        names.append(m[3])
    raw = np.fromfile(fetch(cache, stem + '.dat'), dtype='<i2').reshape(-1, nch).astype(np.float64)
    return (raw - np.array(base)) / np.array(gain) * 1000.0, names


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else '.cache/grabmyo'
    os.makedirs(cache, exist_ok=True)
    sos = butter(4, [10, 500], 'bandpass', fs=FS, output='sos')
    bn, an = iirnotch(60, 30, FS)
    a, b = WINDOW
    clips = []
    for key, g, name in GESTURES:
        trials = []
        for t in TRIALS:
            uv, names = load_uv(cache, g, t)
            i, j = names.index(f'F{PAIR[0]}'), names.index(f'F{PAIR[1]}')
            y = filtfilt(bn, an, sosfiltfilt(sos, uv[:, i] - uv[:, j]))
            w = y[int(a * FS) : int(b * FS)]
            trials.append((float(np.sqrt((w**2).mean())), t, w))
        trials.sort(key=lambda x: (x[0], x[1]))
        rms, trial, w = trials[len(trials) // 2]
        # Min/max decimation keeps the spikes a plain stride would drop.
        chunks = np.array_split(w, POINTS // 2)
        pts = np.concatenate([[c.min(), c.max()] if c.argmin() < c.argmax() else [c.max(), c.min()] for c in chunks])
        clips.append({'key': key, 'gesture': g, 'trial': trial, 'name': name, 'rmsUv': round(rms, 1), 'uv': pts})
    peak = max(np.abs(c['uv']).max() for c in clips)
    for c in clips:
        c['points'] = [round(float(v), 3) for v in c.pop('uv') / peak]
    out = {
        'source': f'GRABMyo v1.1.0, participant {PARTICIPANT}, day 1 (session {SESSION}); per gesture, the median-RMS trial of 7',
        'channel': f'forearm bipolar pair F{PAIR[0]}-F{PAIR[1]}',
        'filter': '10-500 Hz 4th-order Butterworth, 60 Hz notch',
        'window': f'{a:.2f}-{b:.2f} s of each trial, min/max decimated to {POINTS} points',
        'scale': f'one scale for all clips: peak {peak:.0f} uV = 1',
        'license': 'CC BY 4.0',
        'doi': '10.13026/89dm-f662',
        'clips': clips,
    }
    with open('src/data/hero-trace.json', 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    for c in clips:
        print(f"{c['key']:6s} gesture {c['gesture']:2d} trial {c['trial']}  rms {c['rmsUv']:5.1f} uV  max |x| {max(map(abs, c['points'])):.2f}")
    print(f'peak {peak:.0f} uV')


if __name__ == '__main__':
    main()
