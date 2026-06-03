# Ripple — Pipeline & Stage Log

## Current Stage: 🔵 Develop

**Started:** June 3, 2026  
**Last gate review:** June 3, 2026

---

## Pipeline Framework

Ripple uses a **Hybrid Stage-Gate + Lean** pipeline:
- **Lean Startup** governs the day-to-day: build the minimum thing to test the riskiest assumption
- **Stage-Gate** governs macro decisions: explicit go/hold/archive at each stage boundary

Stages and their gates are defined once, before the project starts — not improvised in the moment.

---

## Stages

| Stage | Status | Entered | Gate Decision |
|---|---|---|---|
| **Idea** | ✅ Done | 2026-06-03 | GO — clear unmet need |
| **Research** | ✅ Done | 2026-06-03 | GO — no direct competitor in this quadrant |
| **Develop** | 🔵 Active | 2026-06-03 | — |
| **Test** | ⏳ Pending | — | — |
| **Monetize** | ⏳ Pending | — | — |
| **Improve** | ⏳ Pending | — | — |

---

## Gate Criteria (Pre-defined)

### Idea → Research
**GO if:** The core concept is clear enough to research in one sentence.  
**HOLD if:** Still fuzzy — spend 1 day clarifying the problem statement first.  
**ARCHIVE if:** The idea doesn't survive a 5-minute sanity check.

### Research → Develop
**GO if:** No direct competitor in the target quadrant (git-native + session analytics + self-hosted + indie-priced) AND your own interest is sustained.  
**HOLD if:** A competitor is close — monitor for 30 days.  
**ARCHIVE if:** The gap is already filled, or the market is too small to matter.

*Research verdict (June 3, 2026):* PostHog is the closest. Requires significant setup, enterprise-scoped. The automatic before/after behavioral diff from git commits does not exist. **→ GO**

### Develop → Test
**GO if:** A working version runs against at least one real project's session data and produces meaningful output.  
**HOLD if:** Core loop works but output isn't clear enough for a real user.  
**ARCHIVE if:** Technical approach is fundamentally broken after two full attempts.

*Gate criteria (pre-defined):* "Ripple runs against example.com sessions, reads git log, generates at least 2 specific suggestions grounded in real data."

### Test → Monetize
**GO if:** At least 3 developers outside yourself have used it and found it valuable. At least 1 said they'd pay for it.  
**HOLD if:** Early users like it but haven't converted to "I'd pay" yet.  
**ARCHIVE if:** No external user finds it more useful than just reading the JSON manually.

### Monetize → Improve
**GO if:** At least 1 paying user (even $5/month) or 10 active self-hosted installs.  
**HOLD if:** Strong interest but no conversion — pricing or install friction may be the issue.  
**ARCHIVE if:** 90 days of monetization attempt with zero conversion and no clear path.

---

## Stage Log

### 2026-06-03 — Idea Captured
Problem statement: "What did this commit do to my users?" No tool answers this automatically for indie developers.

### 2026-06-03 — Research Complete
Market research conducted. PostHog closest competitor, but not git-native or zero-config for the before/after diff use case. Full report in Atlas2.0 vault.

### 2026-06-03 — Develop Started
Repo initialized at `[WEB_ROOT]\ripple`. Core analytics engine exists in Atlas2.0/scripts/session_analytics.py — will be extracted and ported to Ripple.

---

## Riskiest Assumptions (Lean Principle)

Answer these in order — the first one that fails means re-evaluate:

1. **"Developers will install a tracking script on their site"** — Test by: does example.com track.php work? (Yes, already running)
2. **"Git commit timestamps can be reliably correlated with session timestamps"** — Test by: running against example.com with 2 known commits
3. **"Suggestions generated from data will be specific enough to be actionable"** — Test by: first generated suggestion review
4. **"Developers outside Peder will find this valuable"** — Test by: 3 developer pilots

---

## Next Actions

- [ ] Extract session_analytics.py from Atlas2.0 → ripple/src/analytics/
- [ ] Port git_reader to ripple/src/git/
- [ ] Write ripple.config.json format and example
- [ ] Build intelligence/agent.py — reads config goals + session diff → writes suggestions
- [ ] Build minimal dashboard — just deployments + suggestions view
- [ ] Test against example.com live data
- [ ] First suggestion review (is it actually useful?)
