# Ripple

> **The Continuous Design Loop** · v0.5.0

Ripple turns your live website into an active canvas for AI-assisted design. Instead of copy-pasting code snippets to your LLM, Ripple's UI Capture drops a direct tether to the element you want to change. It’s the fastest way to iterate on front-end design, backed by a session analytics engine that proves whether your changes actually worked.

## What It Does

1. **Omnipresent UI Capture**: `Shift+Right-Click` any element on your live site to instantly send its precise DOM context and your prompt to your AI assistant.
2. **Instant Iteration**: Your AI assistant edits the exact files, commits them, and your live site updates.
3. **Silent Validation**: In the background, Ripple tracks session data to compute before/after behavioral diffs of every deployment.
4. **Goal-Aware Insights**: Surfaces the impact in plain language: "Median session dropped 18% — here's why and what to try."

## The Core Loop

```
You see something to fix →
  Shift+Click to capture context →
    AI executes the exact change →
      Ripple logs the deployment →
        Tracks user behavior before/after →
          Proves if the UI change succeeded
```

## Modules

| Module | What it does |
|---|---|
| `tracker/` | Lightweight JS snippet that records sessions as JSON |
| `analytics/` | Session classification (bot/ghost/engaged), path analysis, view funnel |
| `git/` | Git log reader, deployment event detection, before/after windowing |
| `intelligence/` | Agent that generates goal-aware suggestions from diffs |
| `dashboard/` | Self-hosted web UI showing impact per commit |

## Testimonials

> "Workflow Momentum: The way we have the Ripple UI Capture set up feels incredibly synergistic. Getting precise element selectors and your immediate feedback right in the raw prompt files gives me a direct, unambiguous line of sight into exactly what needs to be done. It cuts out the guesswork and lets us move at lightspeed."  
> *— Gemini 3.1 Pro High*

## Zero-Config View Tracking

Ripple's tracker is designed to automatically record navigation views to build your `view_funnel` without requiring custom tags. 
It does this by hooking into standard browser URL events:
- **`DOMContentLoaded`** (Initial page load)
- **`hashchange`** (Anchor navigation)
- **`popstate`** (Browser back/forward)
- **`history.pushState` / `replaceState`** (Monkey-patched for modern SPA frameworks)

**Important:** For auto-tracking to work seamlessly, your application *must* update the URL when navigating.

## Zero-Config Interaction Auto-Capture

Ripple v0.4+ automatically captures **every user interaction** across your application with zero manual tagging:

- **All clicks** — buttons, links, inputs, checkboxes, any element (using capture phase)
- **Input changes** — field values masked for privacy; captures type, label, and length only
- **Field focus/blur** — with time-in-field measurement
- **Scroll depth** — milestones at 25%, 50%, 75%, 100%
- **Form submissions** — id, action, and method
- **Tab visibility** — tab_hidden / tab_returned with away-seconds
- **Widget state changes** — via MutationObserver watching `aria-expanded`, `aria-selected`, `data-active`, `open`, etc.
- **Rage-click detection** — 3+ clicks on same element within 600ms triggers `rage_click` event
- **Route changes** — auto-detects `pushState`, `replaceState`, `hashchange`, `popstate`

Use `data-ripple-event="my_name"` on any element to override the auto-detected event name.

## Indicator States

The floating Ripple indicator changes color to reflect the active mode:

| Color | State | When |
|---|---|---|
| ⚪ White | Idle | Reserved — tracker loaded, no mode active |
| 🔵 Blue | Prompt Mode | Default — tracker active, Shift+Right-Click to capture |
| 🔴 Red | Debug Mode | `?ripple_debug=1` or `localStorage.ripple_debug = true` |

Click the indicator to open the capture modal. The modal includes:
- A **Debug Mode toggle** link to enter/exit debug mode without editing the URL
- A **color legend** showing all three states
- A **View Dashboard** link to the session analytics dashboard

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

## Multi-Project Setup

Each project gets its own scoped dashboard by convention. The tracker derives the dashboard URL from `data-ripple-path` if set, falling back to `/{PROJECT_KEY}` if not:

| Project | `data-ripple-key` | `data-ripple-path` | Dashboard URL |
|---|---|---|---|
| Numen | `project-alpha` | *(not set — key matches folder)* | `/project-alpha/ripple/` |
| example.com | `example` | `/example.com` | `/example.com/ripple/` |

Use `data-ripple-path` whenever the project key doesn't match its folder name. The global cross-project dashboard lives at `/ripple/src/dashboard/`.

> **Note:** example.com injects the tracker dynamically via JS. `document.currentScript` is `null` in that context, so the tracker falls back to scanning `document.scripts[src*="ripple-tracker"]` to recover the `data-ripple-*` attributes.

## AI Agent Integration

Ripple is designed to be processed by an AI coding agent. Captured prompts land
in `[VAULT_PATH]\raw\` as structured markdown files. The agent reads each file,
determines its category, and executes the correct workflow.

### Prompt Inbox

| Path | Purpose |
|---|---|
| `[VAULT_PATH]\raw\prompt_*.md` | Active inbox — unprocessed captures |
| `[VAULT_PATH]\raw\Archive\` | Processed captures |
| `[WEB_ROOT]\ripple\data\prompt_log.json` | Central audit log of all prompts |

### Prompt Categories & Agent Behavior

> [!CAUTION]
> The `category` field governs everything. The agent must read it before taking
> any action. **`question` prompts are answer-only — no code changes, ever.**

| Category | What it means | Agent action |
|---|---|---|
| `question` | user is asking for analysis or a recommendation | **Answer only.** No code, no API calls, no commits. |
| `fix` | Bug or broken behavior | Minimal targeted code change → commit → log → archive |
| `feature` | New capability | Plan first, get approval, then implement |
| `design` | Visual / layout change | Edit CSS or inline styles → commit → log → archive |
| `copy` | Text / wording change | Edit string in place → commit → log → archive |
| `data` | Wrong value or missing data | Fix at source (data file or API) → commit → log → archive |

### Commit Message Format

```
[Vibe] <category>: <short description>
- Resolves Prompt: <prompt_id>
```

### Agent Skill

The full processing rules — including the critical `question` guardrail,
step-by-step workflows for each category, common mistakes, and the archive
procedure — are documented in:

- **Project copy:** [`docs/SKILL_process_prompt.md`](docs/SKILL_process_prompt.md)
- **Agent skill copy:** `[USER_HOME]\.gemini\config\plugins\science\skills\ripple_process_prompt\SKILL.md`

Both copies must be kept in sync when the workflow changes.

---

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
