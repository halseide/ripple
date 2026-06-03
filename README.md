# Ripple

> **What did this commit do to your users?**

Ripple is a self-hosted, git-native analytics tool that automatically correlates every code deployment with real user behavior — and tells you what to do next.

## What It Does

Every time you push code, Ripple:
1. Reads your git log to mark the deployment event
2. Computes before/after behavioral diffs from your session data
3. Surfaces the impact in plain language: "Median session dropped 18% — here's why and what to try"
4. Generates specific, goal-aware suggestions tied to your project intent
5. Tracks whether those suggestions were acted on and whether they worked

## The Core Loop

```
You ship code →
  Ripple reads the commit →
    Compares user behavior before/after →
      Generates suggestions (from data + your goals) →
        Tracks accountability →
          Measures outcome of suggestions →
            Informs the next commit
```

## Modules

| Module | What it does |
|---|---|
| `tracker/` | Lightweight JS snippet that records sessions as JSON |
| `analytics/` | Session classification (bot/ghost/engaged), path analysis, view funnel |
| `git/` | Git log reader, deployment event detection, before/after windowing |
| `intelligence/` | Agent that generates goal-aware suggestions from diffs |
| `dashboard/` | Self-hosted web UI showing impact per commit |

## Quick Start

```bash
# 1. Drop the tracker on your site
<script src="ripple.js" data-project="my-project"></script>

# 2. Point Ripple at your sessions folder and git repo
cp ripple.config.example.json ripple.config.json
# edit ripple.config.json

# 3. Run analysis
python scripts/analyze.py
```

## Status

🔵 **Stage: Develop** — actively building. First working version targets example.com as the proving ground.

See [PIPELINE.md](docs/PIPELINE.md) for current stage and next actions.

## Philosophy

Built for indie developers and vibe-coders who:
- Ship via git push, not deployment pipelines
- Don't have a data team
- Want to know if their last change helped or hurt
- Can't afford enterprise analytics ($200+/mo)

Self-hosted. Your data stays local. No cloud dependency.

## License

MIT
