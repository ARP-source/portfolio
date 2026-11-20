---
title: Downshift
oneLiner: Start on the cheapest model, check the answer, escalate only when it fails. I deleted my own difficulty classifier after it failed validation, and the system got better.
role: "TODO(anuraag): your role"
dates: "2026, MantisGrid AI Hackathon & Summit"
status: prototype
stack: [Python, FastAPI, W&B Inference, Weave]
links:
  repo: https://github.com/ARP-source/downshift
keyMetric:
  label: cost vs always-flagship, same 14 code tasks
  value: "−96%"
  unit: "$0.0008 vs $0.0204"
  source: README results table, 4 live runs
audience: [swe]
---

## Question

Model routers usually predict which model a prompt needs. Is prediction actually what saves money, or is it the act of checking the answer and escalating?

## Setup

- 14 programming tasks. Each arm writes a Python function, which is executed against 53 test assertions: it passes all of them or it fails. No string matching, no partial credit.
- A three-tier ladder on W&B Inference: `openai/gpt-oss-20b`, `meta-llama/Llama-3.3-70B-Instruct`, `deepseek-ai/DeepSeek-V4-Pro-0813`.
- Four arms, four independent runs against live models.

## Result

| Strategy | Solved | Cost | p50 |
| --- | --- | --- | --- |
| Always the flagship | 10–12 / 14 | $0.0204 | 2405 ms |
| Always the cheapest | 11–13 / 14 | $0.0006 | 2622 ms |
| Difficulty routing (tested, rejected) | 12–13 / 14 | $0.0014 | 1377 ms |
| Downshift: verify and escalate | 13–14 / 14 | $0.0008 | 2824 ms |

Downshift solved the most tasks at 96% less than always-flagship. It is also the slowest arm at the median, because it tries the cheap tier first. Source: README, measured against live models.

## What failed

The difficulty scorer failed its own validation: mean score by independently assigned level was flat (easy 0.382, medium 0.407, hard 0.404). Deleting it won: one more task solved and 61–95% less cost than the routed arm. On 74 short factual questions all three arms scored 90.0%, so the honest answer there is to skip routing and use the cheap model.

## What's next

Replace the lexical scorer with one learned from the per-band outcome data the system already collects, and test on a larger task set; the hard-task result rests on four problems.
