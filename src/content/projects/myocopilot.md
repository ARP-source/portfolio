---
title: MyoCopilot
oneLiner: An adaptive myoelectric control copilot that notices when EMG drifts and asks the user for a few fresh samples before control fails.
role: "TODO(anuraag): your role (solo build or team?)"
dates: "2026, hackathon build · TODO(anuraag): exact dates"
status: prototype
stack: [Python, FastAPI, WebSockets, SciPy, scikit-learn, React, TypeScript, three.js, GLM-5.3-Flash]
links:
  repo: https://github.com/ARP-source/MYOCOPILOT
audience: [neuro, swe]
---

## Question

A gesture classifier for a prosthetic hand is trained on a clean signal, then electrodes shift, skin gets sweaty and a harness rotates. Can the system notice that its own input has drifted, and recover by asking the user for a few new examples instead of failing silently?

## Setup

- Public sEMG recordings (NinaPro DB2, Meta emg2pose mini) are replayed as a live stream and cut into 250 ms windows with a 50 ms stride.
- Each window becomes a multi-channel spectrogram plus RMS features. The production path classifies them with GLM-5.3-Flash through OpenRouter.
- A drift detector watches rolling accuracy and the confusion pattern. When it suspects drift, the agent names the confused gesture, asks for three fresh repetitions, and folds them into that user's gesture profile.
- Drift can be injected on purpose (`electrode_shift`, `sweat`, `channel_swap`) so the loop can be tested end to end. A procedural three.js hand mirrors the predicted gesture.

## Result

TODO(anuraag): real NinaPro results pending.

The evaluation file in the repo (`eval/results.json`) was produced with `mock_mode: true`: a network-free RMS heuristic on structured synthetic signals. It shows the pipeline runs end to end. It is not evidence about real EMG, so no accuracy number is reported here.

## What failed

The evaluation so far never touches real EMG with the real classifier, so the central claim (that recalibration recovers control on real drift) is untested. The drift model is a structured synthetic stress test, not a physiological one.

## What's next

- Run the full loop on real NinaPro DB2 subjects and report accuracy before drift, after drift and after recalibration.
- Compare against the classical baseline already in the repo (`eval/baselines.py`, k-NN on RMS).
- TODO(anuraag): record the demo video; the README link is still a placeholder.
