# Ripple — userure

## Overview

Ripple is a Python + HTML/JS tool. No framework dependencies. No cloud. Runs locally against your project's session JSON files and git repo.

## Data Flow

```
User visits your site
  → ripple.js (tracker) writes sess_[id].json to /sessions/
  → User navigates, clicks, leaves
  → Session file closed with full event log

You run: python scripts/analyze.py
  → git.py reads git log → deployment events with timestamps
  → analytics.py classifies sessions (bot/ghost/glancer/engaged/deep)
  → analytics.py computes navigation paths, view funnel, before/after windows
  → intelligence.py reads diffs + your ripple.config.json goals
  → intelligence.py writes suggestions to ripple_suggestions.json
  → dashboard generates project_analytics.json for the web UI
```

## Module Responsibilities

### tracker/ — Client-side JS
- `ripple.js` — drop-in script tag, zero config beyond data-project attribute
- Records: page views with timing, interaction events, referrer, user agent
- Stores as: `/sessions/sess_[uuid].json` on the server via fetch POST to `track.php`
- Design principle: no cookies, no fingerprinting, no PII

### analytics/ — Python core (extracted from Atlas2.0)
- `session_analytics.py` — session classification, path analysis, funnel, deployment correlation
- `classify.py` — bot/ghost/bounce/glancer/engaged/deep classifier
- `paths.py` — navigation path aggregation
- `funnel.py` — view funnel with drop-off rates

### git/ — Deployment event reader
- `git_reader.py` — reads git log with `--format=%H\x1f%aI\x1f%s`
- `deployment.py` — windows sessions into before/after each commit
- Supports: local git repos, future: webhook receiver for CI/CD

### intelligence/ — Suggestion engine
- `agent.py` — reads behavioral diffs + ripple.config.json goals
- `suggestions.py` — writes/reads ripple_suggestions.json with lifecycle tracking
- Suggestion lifecycle: open → accepted → shipped → measured → dismissed
- Design principle: suggestions are grounded in data + stated intent, not generic advice

### dashboard/ — Web UI
- `index.html` — the main analytics dashboard
- `projects.html` — project overview (for multi-project installs)
- `analytics.js` — fetches JSON, renders all panels
- Reads: `data/project_analytics.json`, `data/ripple_suggestions.json`

## Config Format

```json
{
  "projects": [
    {
      "key": "example",
      "name": "example.com",
      "url": "https://example.com",
      "sessions_dir": "./sessions",
      "git_repo": ".",
      "goals": [
        "Increase median session duration",
        "Get users to reach the trivia view",
        "Drive swag purchases"
      ],
      "interaction_events": ["game_started", "jump_initiated", "swag_ordered"]
    }
  ]
}
```

## Key Design Decisions

### ADR-001: JSON files over database
Sessions stored as individual JSON files. Pros: zero infrastructure, debuggable, portable. Cons: slow at scale (>100k sessions). Will add SQLite aggregation layer when needed.

### ADR-002: Python for analytics, JS for tracker
Python because: string manipulation, subprocess (git), existing session_analytics.py codebase. JS for tracker because: must run in browser.

### ADR-003: Self-hosted first, managed cloud later
Zero cloud dependency for v1. Forces clean local design. Managed tier added when open source adoption warrants it.

### ADR-004: Goals are stated in config, not inferred
The intelligence layer reads your stated goals from ripple.config.json. It does not guess your intent. This prevents hallucinated suggestions and keeps accountability grounded.
