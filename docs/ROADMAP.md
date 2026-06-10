---
status: active
type: roadmap
last_updated: 2026-06-09
project: Ripple
---
# Ripple Project Roadmap

This roadmap documents the evolution of the Ripple project, specifically capturing proposed interaction models, instrumentation features, and the design advisory board pushbacks to maintain the product's essentialist core ("Less but Better").

---

## 📐 Core Philosophy: The Dieter Rams Principle

Ripple is designed as a zero-config, low-overhead session analytics and UI prompt capture utility. To prevent cognitive sludge and feature bloat, every change must align with Rams' mandate: **"Weniger, aber besser" (Less, but better).**

---

## 🌐 Active Feature Proposals & Pushback Log

### 1. Stateful Inspect Selection Mode (The Hotkey Change)
*   **Proposed Idea:** Replace the stateless modifier capture flow with a stateful mode toggled via the backtick key (`` ` ``). Once active, hovering over elements displays a visual highlight, and clicking captures the target element.
*   **Design Advisory Board Verdict:** **REJECT** the backtick toggle; **RETAIN & REFINE** the stateless click modifier.
*   **Pushback Rationale:**
    1.  *Keyboard Collisions:* The backtick key is widely used by developers in markdown editors, template strings in JS, and terminals. Intercepting it globally breaks natural host application input.
    2.  *Interaction Friction (Don Norman's "Slips"):* Toggling a mode creates state. If the user forgets they are in "Inspect Mode," standard navigation clicks are intercepted, causing frustration.
    3.  *Performance Overhead:* running continuous `mousemove` event listeners to calculate element dimensions (`getBoundingClientRect`) induces browser reflow and repaint thrashing, degrading host application performance.
*   **Refinement Path:** Retain the stateless `Shift + Left-Click` capture shortcut. Upgraded visual affordances (such as a temporary subtle indicator appearing when `Shift` is held) are preferred over toggled states.

### 2. Capturing Computed CSS & Element Screenshot Crops
*   **Proposed Idea:** Capture and store the computed CSS style rules and binary screenshot crops of the selected element inside the prompt telemetry payload.
*   **Design Advisory Board Verdict:** **REJECT** computed CSS and screenshot capture.
*   **Pushback Rationale:**
    1.  *Telemetry Storage Bloat:* Computed CSS contains hundreds of rules per element, and screenshot crops generate binary data. Appending these to the lightweight JSON telemetry files (`prompt_log.json`) will bloat files from kilobytes to megabytes, dragging down the dashboard's load times and increasing storage costs.
    2.  *Browser Security (CORS):* Capturing element screenshots via client-side canvas rendering (e.g. `html2canvas`) triggers browser CORS security blocks when elements contain cross-origin assets, fonts, or iframe structures, making the feature highly fragile.
    3.  *Performance Jank:* Compiling computed styles via `window.getComputedStyle` and rendering visual crops blocks the browser's single thread, causing noticeable user-interface stutter precisely when the developer is trying to record a prompt.
    4.  *Privacy & Security (OpSec):* Automatic screenshots may capture sensitive user data, API keys, or private client information, creating data compliance (GDPR/CCPA) headaches.
    5.  *Minimalist Scope:* Ripple's value lies in correlating code deployments with developer intent and user prompts. Knowing the exact computed padding or seeing a thumbnail of a button does not provide proportional value compared to capturing the element's selector path, text content, and the user's prompt text.

---

## 🗺️ Strategic Roadmap & Release Phases

### Phase 1: Core Foundation (MVP - Active)
*   [x] Stateless interaction capture via `Shift + Left-Click`.
*   [x] Zero-dependency client tracker script: `src/tracker/ripple-tracker.js` (~70KB unminified).
*   [x] Multi-project local dashboard interface.
*   [x] Core prompt capture API (`api/capture_prompt.php`) saving to `data/prompt_log.json`.
*   [x] Unified session tracking.
*   [x] Segmented session control banner (`Home`, `Prompt`, `Debug` switcher).

### Phase 2: Telemetry dashboard panel
*   [ ] Add the "Prompt Log" dashboard panel in `src/dashboard/index.html` (reading from `data/prompt_log.json`) to visualize captured prompts across all projects, showing status badges (`pending`, `shipped`, `wont_fix`), element context, and target commit hashes.
*   [ ] Upgraded session timeline visualizer.
*   [x] Telemetry-Driven Metric Goals (v0.11.0) - auto-checks view duration and event conversion goals against a configurable lookback window, raising alerts in the Suggestions panel.

### Phase 3: Developer Integration & Distribution
*   [ ] Safe configuration ignore decoupling (`ripple.config.json`) to prevent private paths from committing to public remotes.
*   [ ] Unified installer package (zip/git clone) containing the PHP backend and tracker script.
*   [ ] Secure git history scrubbing protocols for Vibe Coders.
