# Ripple

> **The Continuous Design Loop**

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

Ripple now automatically tracks clicks on all interactive elements across your application! You no longer need to manually tag buttons.
The tracker intelligently listens for clicks on:
- `<button>`
- `<a>`
- `<input type="submit">` or `<input type="button">`
- `[role="button"]`

When a user clicks one of these elements, Ripple extracts the text label, class, or ID and logs a `button_clicked` or `link_clicked` event.
*Note: If you still want to explicitly name an event, you can manually add `data-ripple-event="my_custom_name"` and Ripple will prioritize it.*

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
