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
  → intelligence.py reads diffs + goals from prompt_log.json
  → intelligence.py writes suggestions to ripple_suggestions.json
  → dashboard generates project_analytics.json for the web UI
```

## Module Responsibilities

### tracker/ — Client-side JS
- `ripple.js` — drop-in script tag, zero config beyond data-project attribute
- Records: page views with timing, interaction events, referrer, user agent
- Stores as: `/sessions/sess_[uuid].json` on the server via fetch POST to `track.php`
- Design principle: no cookies, no fingerprinting, no PII

### analytics/ — Python core (extracted from parent system)
- `session_analytics.py` — session classification, path analysis, funnel, deployment correlation
- `classify.py` — bot/ghost/bounce/glancer/engaged/deep classifier
- `paths.py` — navigation path aggregation
- `funnel.py` — view funnel with drop-off rates

### git/ — Deployment event reader
- `git_reader.py` — reads git log with `--format=%H\x1f%aI\x1f%s`
- `deployment.py` — windows sessions into before/after each commit
- Supports: local git repos, future: webhook receiver for CI/CD

### intelligence/ — Suggestion engine
- `agent.py` — reads behavioral diffs + goals from prompt_log.json
- `suggestions.py` — writes/reads ripple_suggestions.json with lifecycle tracking
- Suggestion lifecycle: open → accepted → shipped → measured → dismissed
- Design principle: suggestions are grounded in data + stated intent, not generic advice

### api/ — PHP Endpoints
- `session.php` — receives tracker POST data, writes session JSON files
- `capture_prompt.php` — receives UI Capture prompts, writes to raw inbox + prompt_log.json
- `config.php` — **[NEW v0.6.0]** GET/POST endpoint for reading and writing `ripple.config.json`. Localhost-only. Used by the dashboard Settings panel.

### dashboard/ — Web UI
- `index.html` — the main analytics dashboard
- Reads: `data/project_analytics.json`, `data/ripple_suggestions.json`, `api/config.php`
- Settings panel (`⚙️ Settings` gear button in header) — slide-in editor for all per-project config fields including `github_url`

## Config Format

```json
{
  "projects": [
    {
      "key": "project-alpha",
      "name": "example.com",
      "url": "https://example.com",
      "github_url": "https://github.com/user/repo",
      "sessions_dir": "./sessions",
      "git_repo": ".",
      "interaction_events": ["game_started", "jump_initiated", "swag_ordered"]
    }
  ]
}
```

`github_url` is optional. When present, commit hashes in the Prompt Log render as clickable links to that GitHub repo. When absent or empty, hashes render as plain monospace text with a tooltip directing you to Settings.

## Key Design Decisions

### ADR-001: JSON files over database
Sessions stored as individual JSON files. Pros: zero infrastructure, debuggable, portable. Cons: slow at scale (>100k sessions). Will add SQLite aggregation layer when needed.

### ADR-002: Python for analytics, JS for tracker
Python because: string manipulation, subprocess (git), existing session_analytics.py codebase. JS for tracker because: must run in browser.

### ADR-003: Self-hosted first, managed cloud later
Zero cloud dependency for v1. Forces clean local design. Managed tier added when open source adoption warrants it.

### ADR-004: Goals are managed via prompt system, not inferred
The intelligence layer reads your stated goals dynamically from the prompt log (`prompt_log.json`) under the `goal` category. It does not guess your intent. This prevents hallucinated suggestions and keeps accountability grounded.

### ADR-005: Settings panel writes config via localhost-only PHP API
Rather than require developers to hand-edit JSON, the dashboard includes a Settings panel that reads and writes `ripple.config.json` through `api/config.php`. The endpoint is restricted to `127.0.0.1` / `::1` to prevent remote config modification. A `.bak` file is written before every save. The config file remains the single source of truth — the API is just a safe wrapper.
