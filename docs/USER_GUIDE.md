# Ripple — User Guide

> **Version:** v0.9.0 · **Last Updated:** 2026-06-08

Ripple is a live UI capture and session analytics tool. It runs on every page where the tracker is installed, gives you a direct line from browser to AI inbox, and measures whether your changes actually worked.

---

## Quick Start

### 1. Open any page where Ripple is installed

Look for the small **colored dot** in the bottom-right corner of the page:

| Color | State | Meaning |
|---|---|---|
| 🔵 Blue | Prompt Mode | Active. Ready to capture. |
| ⚪ White | Idle (Home) | Tracker loaded, capture paused. |
| 🔴 Red | Debug Mode | Live event stream visible in overlay. |

### 2. Capture a prompt

**`Shift + Right-Click`** any element on the page.

A modal appears with:
- The element you clicked (tag, ID, classes)
- Its full CSS selector path
- A textarea for your prompt
- A category dropdown

### 3. Write your prompt, pick a category

| Category | Use for |
|---|---|
| `fix` | Bug, broken layout, wrong behavior |
| `feature` | Something that doesn't exist yet |
| `design` | Visual / spacing / color / animation |
| `copy` | Text, labels, tooltips, wording |
| `data` | Wrong value, missing field, stale content |
| `question` | Ask AI to explain or recommend — no code changes |

### 4. Press ⚡ Send to AI Inbox (or `Shift+Enter`)

The prompt is saved to `/raw/` as a `.md` file and logged to `prompt_log.json`. A **throbbing purple dot** (breadcrumb) appears at the exact pixel where you clicked.

### 5. AI processes the inbox

Next time you ask the AI to process `/raw/`, it reads the prompt, executes the correct workflow for the category, commits the fix, and archives the file.

---

## Breadcrumb Dots

After a prompt is saved, a **small pulsing purple dot** appears at the x,y coordinates where you right-clicked. This is your breadcrumb — a visual marker that says "I left a note here."

| Action | What happens |
|---|---|
| **Hover** | Shows a tooltip with a snippet of your prompt |
| **Click** | (Reserved for future actions) |
| **Page refresh** | **Dot persists!** The tracker fetches pending prompts from the database and visually re-attaches them to the correct DOM elements. |
| **Scroll / Navigate** | Dots intelligently hide if scrolled underneath a sticky header, or if you switch tabs in a Single Page App. |

> **How does persistence work?** Breadcrumbs are mathematically bound to the specific DOM element you clicked. If you navigate away or refresh, the tracker reads `prompt_log.json`, finds the target element, and re-attaches the dot. Once an AI agent resolves or dismisses your prompt, the dot disappears permanently.

### What about "Blobs"?

You might hear these visual markers referred to informally as "Blobs." *Breadcrumbs* is the formal name for the feature because they function like a trail of notes you leave behind, letting you navigate back to exactly where you were. "Blobs" is simply the colloquial term used to describe their visual appearance—little pulsing dots on the screen. Functionally, they are the exact same thing.

---

## Zero-Config View Tracking

Ripple's tracker automatically records navigation views to build your `view_funnel` without requiring custom tags. It does this by hooking into standard browser URL events:
- **`DOMContentLoaded`** (Initial page load)
- **`hashchange`** (Anchor navigation, e.g., appending `#section2` triggers a new view)
- **`popstate`** (Browser back/forward)
- **`history.pushState` / `replaceState`** (Monkey-patched for modern SPA frameworks like React/Vue/Next.js)

**Important:** For auto-tracking to work seamlessly, your application *must* update the URL when navigating. Changing the hash (`#`) or query string (`?`) is sufficient to trigger a new distinct view in the session log.

---

## The Dashboard

Each project has a dashboard at `http://localhost/{project}/ripple/`.

| Project | Dashboard URL |
|---|---|
| Handshake | http://localhost/project-beta/ripple/ |
| Numen | http://localhost/project-alpha/ripple/ |
| Jumpoff | http://localhost/example.com/ripple/ |

The dashboard shows:
- **Vitals** — sessions, engagement, bounce rate, and project-specific metrics
- **Activity Timeline** — hourly session chart
- **Ripple Log** — all prompts with status (`pending`, `answered`, `shipped`, `dismissed`), filterable by status and category
- **Configuration** — live `ripple.config.json` settings for the project

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Shift + Right-Click` | Open prompt capture modal |
| `Shift + Enter` | Submit prompt (inside modal) |
| `Esc` | Close modal without saving |

---

## Modes

Switch modes from the modal footer (`⚪ Home · 🔵 Prompt · 🔴 Debug`):

- **Prompt Mode** (default): Shift+Right-Click opens the capture modal.
- **Home/Idle Mode**: Tracker is loaded but capture is paused. Click anywhere to see a status card.
- **Debug Mode**: Live event overlay shows every tracked event in real time. Use to verify tracking is working.

---

## FAQ

**Q: The breadcrumb dot disappeared when I refreshed. Did I lose my prompt?**
No! If a dot disappears, it simply means the exact DOM element you clicked on no longer exists on the screen (e.g. you navigated to a different view), or the AI agent has marked your prompt as `shipped` or `dismissed`. Your prompt is always safe in `prompt_log.json`. Open the dashboard → Ripple Log to see it.

**Q: How do I dismiss a prompt I no longer need?**
From the Ripple dashboard → Ripple Log, the AI can mark it `dismissed` on your behalf when you tell it to. The prompt thread is then archived.

**Q: What's the difference between `question` and `fix`?**
`question` means "tell me how this works / what you recommend" — the AI answers in chat only and writes no code. `fix` means "this is broken, change it" — the AI edits files, commits, and logs a commit hash.

**Q: Can I use Ripple on a page that's already in production?**
Yes. The tracker is a single `<script>` tag that injects with zero markup changes. It communicates back to `/ripple/api/` on your local server, so captures from production would need a local endpoint. For localhost work it's already wired.

**Q: The modal says "Error: Unknown error" when I submit.**
The tracker is trying to POST to `/ripple/api/capture.php`. Check that Laragon is running and the Ripple API directory is correctly pathed. Open DevTools → Network to see the exact response.

**Q: Why is my indicator dot white instead of blue?**
You're in Home/Idle mode. Click the dot, then click "🔵 Prompt" in the modal footer to re-enter prompt mode.

**Q: How do I add Ripple tracking to a new project?**
1. Add the project to `ripple.config.json` with a `key`, `url`, `sessions_dir`, `git_repo`, and `goals` array.
2. Add the `<script>` tag to the project's HTML: `<script src="/ripple/src/tracker/ripple-tracker.js?v={version}" data-project-key="{key}" defer></script>`
3. Create a `ripple/` folder in the project and copy `index.html` from an existing project dashboard, updating the `PROJECT_KEY`.
4. Add a `sessions/` directory to the project root.

**Q: What data does Ripple collect?**
Sessions, clicks (element tag/label/path, never text content), field focus/blur (time-in-field only, no values), scroll depth milestones, form submissions, tab visibility. All data stays local — nothing is sent to a third-party service.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Shift+Right-Click does nothing | Tracker not injected on this page | Check the `<script>` tag is in the page's HTML |
| Modal opens but Send fails | Laragon not running or `/ripple/api/` path wrong | Start Laragon, check network tab |
| Breadcrumb appears but dashboard shows no prompt | `prompt_log.json` write failed | Check `/ripple/data/` directory permissions |
| Version shows wrong in modal | Script cache | Hard-refresh `Ctrl+Shift+R` |
| Dot is in wrong position after scroll | Old version of tracker (pre-v0.7.7) | Update tracker — fixed in v0.7.7 |
