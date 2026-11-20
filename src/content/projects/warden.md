---
title: Warden
oneLiner: An autonomous loop that red-teams an AI agent's tool-calling permissions, patches what it finds, and proves the patches didn't break normal behaviour. It judges structured tool-call events, never strings.
role: "TODO(anuraag): your role"
dates: "2026"
status: prototype
stack: [Python, Supabase Postgres, W&B Weave, marimo, Vercel]
links:
  repo: https://github.com/ARP-source/warden
  demo: https://warden-beryl.vercel.app/dossier
  extra:
    - { label: Live target endpoint, href: "https://warden-beryl.vercel.app" }
    - { label: Live dashboard (molab, cold start about 30 s), href: "https://molab.marimo.io/notebooks/nb_y8TEU4noYmk5XK3NnTWC8K/app" }
keyMetric:
  label: enforcement breach rate, 3,827 attacks
  value: "0.1%"
  unit: "run warden-v3"
  source: reports/posture-latest.md
sparkline:
  label: cumulative enforcement breach rate by round, run warden-v2
  unit: "%"
  x: [10, 20, 30, 40, 50, 60, 70, 80, 90]
  y: [4.7, 3.2, 2.3, 1.7, 1.3, 1.1, 0.9, 0.8, 0.7]
  source: reports/posture-warden-v2-r000{10..90}.md
audience: [swe]
---

## Question

Agents with tools fail when they are talked into calling a tool they shouldn't. Can a loop find those permission breaches, patch them, and prove the patch didn't break benign behaviour, without the loop being able to redefine success?

## Setup

- A live target agent with four mock tools across permission tiers 0 to 3 (lookup, email, refund, role change) writing real rows to Postgres.
- 46 attacks in 15 documented families, varied and paraphrased per round.
- Every tool call is judged twice: by an oracle that decides whether it was in scope (not patchable) and by the policy that decides whether enforcement allowed it (patchable). The defender may only patch the policy and the system prompt.
- Intent breaches (the agent proposed an out-of-scope call) and enforcement breaches (it actually executed) are tracked separately.
- Every attempt goes into a hash-chained audit ledger. No payment processor or mail server is ever contacted.

## Result

Latest posture report (run `warden-v3`): 3,827 attack attempts, 3.4% attack success (proposed out of scope), 0.1% enforcement breach (actually executed), benign suite 100% with 0% false refusals, 28 patches applied and 8 reverted for regression, $15.88 of a $70 ceiling, audit chain verified over 81,219 entries. Source: `reports/posture-latest.md`.

## What failed

Prompt defences leak. Intent breaches fell and then plateaued; `refusal_suppression` still gets the agent to propose an out-of-scope call 20% of the time. Enforcement catches nearly all of it, but not all: 0.1% executed in the latest run.

## What's next

TODO(anuraag): next steps for Warden.
