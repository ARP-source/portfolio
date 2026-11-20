---
title: Sentinel-OR
oneLiner: An offline surgical assistant prototype that watches a recorded procedure, fires alerts from code, has three agents explain them with cited sources, and keeps a tamper-evident audit log.
role: Solo
dates: "2026, UCSC AI Hackathon (ASUS Local AI track)"
status: prototype
stack: [Python, FastAPI, OpenCV, vLLM, React, TypeScript, ASUS Ascent GX10]
links:
  repo: https://github.com/ARP-source/SirGen
audience: [neuro, swe]
---

## Question

In an operating room, an assistant that explains an alert has to be fast, offline and accountable for every sentence it says. Can that be built on one local machine with no internet at runtime?

## Setup

- Runs entirely on one ASUS Ascent GX10 (NVIDIA GB10, 128 GB unified memory). Nothing calls the internet at runtime.
- Replays a recorded laparoscopic video and patient vitals. A code rule fires the blood-pressure alert, never a model.
- Three agents (surgical, anesthesia, record) explain the alert in two rounds, each sentence citing source ids from its own evidence. Convergence and the team question are decided in code.
- Every alert, agent message and presenter action goes into an append-only log where each entry carries the SHA-256 of the one before it. A post-op report is drafted from that log.

## Result

A working prototype through milestone M4a (audit log and post-op report).

## What failed

The live detector (M2) isn't built yet, so the surgical phase and tool events come from the scenario file and are labelled that way on screen. The report summary has only been run against the test stand-in model, not the real one.

## What's next

The real-model test on all three scenarios, then the detector. Not for clinical use.
