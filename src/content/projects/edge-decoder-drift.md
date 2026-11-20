---
title: edge-decoder-drift
oneLiner: Does compressing an intracortical BCI decoder for on-body hardware make it more fragile to cross-session drift, and can a quantized decoder still recalibrate on-device?
role: "TODO(anuraag): your role"
dates: "2026, ongoing"
status: in-progress
stack: [Python, scikit-learn, PyTorch, FALCON benchmark, Jetson Orin Nano Super, JetPack 6.2.1, CUDA 12.6]
links:
  repo: https://github.com/ARP-source/edge-decoder-drift
keyMetric:
  label: FALCON H1 held-in R², reproduced
  value: "0.1943"
  unit: "vs 0.195 reported"
  source: docs/reproduction.md
investigating:
  - { item: Hardware environment verified, done: true }
  - { item: FALCON H1 baselines reproduced, done: true }
  - { item: Torch decoder baseline reproduced, done: false }
  - { item: M1/M2 multi-session monkey datasets, done: false }
  - { item: Quantization sweep (FP32, FP16, INT8 PTQ, INT8 QAT, pruning), done: false }
  - { item: Power measurement harness (INA3221 rails), done: false }
  - { item: On-device recalibration experiments, done: false }
audience: [neuro]
---

## Question

Robustness work evaluates decoders at full precision on workstation GPUs. Efficiency work evaluates within one session and usually estimates power from operation counts. A deployed iBCI lives in both regimes at once. Does compression widen the gap between held-in and held-out sessions, and does few-shot recalibration still work when it has to run on the embedded device itself?

## Setup

- Data: the [FALCON benchmark](https://github.com/snel-repo/falcon-challenge) (Karpowicz et al., NeurIPS 2024 Datasets and Benchmarks), which has held-in and held-out sessions plus few-shot recalibration data.
- Hardware: NVIDIA Jetson Orin Nano Super developer kit (8 GB), JetPack 6.2.1, L4T R36.4.7, CUDA 12.6, 25 W power mode.
- Energy, planned: joules per inference read from the onboard INA3221 rails, not estimated from FLOPs. Those rails report module power (SoC and memory), not the whole board, and every energy figure will say so.

## Result

Setup and validation only; no novel results yet. The FALCON H1 sklearn baseline reproduces:

| Metric | Reported (FALCON README) | Reproduced |
| --- | --- | --- |
| Held-in R² mean | 0.195 | 0.1943 |
| CV fit score | 0.26 | 0.24 |

Also measured: normalized latency 0.3674, held-in R² standard deviation 0.0292. Source: `docs/reproduction.md`.

## What failed

The CV fit score is 0.02 below the reported value and the cause is not explained yet. The candidates are scikit-learn version drift, or a revision of the DANDI dataset since the README was written (it is served as a draft). The evaluation number, which the benchmark actually scores, matches to three decimal places, so this is not blocking.

## What's next

The checklist above, in order: a torch decoder baseline, the multi-session monkey datasets, the quantization sweep, the power harness, then on-device recalibration.
