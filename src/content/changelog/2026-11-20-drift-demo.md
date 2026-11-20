---
date: 2026-11-20
version: "0.3"
title: The drift demo
---

The section after the projects is now something you can try. It replays one GRABMyo participant's real forearm recordings while you hold a button, and a linear discriminant classifier trained on their day-1 data labels each 200 ms window in the page. Skipping to day 29 keeps the day-1 model, and its accuracy drops for real. Three rounds of fresh day-29 samples bring it back. The particles recruit into a raster with the recording's envelope, form the hand the classifier reads, and stain blue when it drifts. The numbers across all 43 participants come from a script in `research/`, and the page computes the participant's own numbers with the same code it runs.
