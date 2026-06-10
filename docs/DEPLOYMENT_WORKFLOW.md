# Ripple — Deployment & Telemetry Workflow

This guide explains the developer workflow for utilizing Ripple's Git-integrated telemetry tracking. It codifies how local code commits, production user sessions, download/sync intervals, and behavioral compilation work together.

---

## The Concept: Git-Linked Telemetry

Ripple does not connect directly to your production server's code. Instead, it relies on your **local Git repository** as the timeline authority.

1. **Commit Timestamp:** When you make a local Git commit, Git records a timestamp (in UTC). This serves as your "deployment event marker."
2. **Session Timestamps:** When a user visits your production site, the tracker logs their session start time (as a UTC ISO-8601 string, e.g. `2026-06-10T10:15:00.000Z`).
3. **Correlation (Deployment Windows):** When you compile analytics, Ripple maps each session's start time against your Git commit times:
   - Sessions starting *before* a commit fall into the "Before" behavior window.
   - Sessions starting *after* a commit fall into the "After" behavior window.

This allows Ripple to measure shifts in user behavior (e.g. session duration, clicks, page paths, bounces) caused by your code updates.

---

## Step-by-Step Developer Workflow

### Step 1: Stage and Commit Changes Locally
Before deploying your changes, you must commit them in your local Git repository. This registers the release event time.
```bash
# From your project directory (e.g., jumpoff.space)
git add .
git commit -m "[Vibe] feat: optimize mobile layout and touch targets"
```
*Note: Make sure your `ripple.config.json` file points to this repository in its `"git_repo"` configuration.*

### Step 2: Deploy to Production
Upload your modified code files (along with the `/api/session.php` script and any assets) to your production web server.
* Ensure the production `/sessions/` directory is writable by the web server process (e.g. `chmod 775 sessions/`).

### Step 3: Collect Telemetry
As users visit the live production site, their browsers will automatically send event logs to `api/session.php`. The server will write these logs to the production `/sessions/` folder as `sess_*.json` files.

### Step 4: Download / Sync Sessions Locally
Periodically (e.g. daily, weekly, or immediately after testing a release), download the session JSON files from your production server's `sessions/` folder into your local project's `sessions/` folder (configured as `"sessions_dir"` in your `ripple.config.json`).
* You can use FTP, `rsync`, `scp`, or a script to sync these files down.

### Step 5: Compile Analytics
Run the compile script in the Ripple directory to merge the Git commit history and the synced production sessions:
```bash
# From your local ripple directory
python scripts/analyze.py
```
This parses the Git history log, matches session timestamps, and outputs the results to `ripple/data/project_analytics.json`.

### Step 6: View the Dashboard
Open your local project dashboard (e.g., `http://localhost/ripple/src/dashboard/`). You will see your recent Git commit plotted on the activity timeline, with comparative statistics showing how user engagement shifted after the release.

---

## Troubleshooting & Best Practices

* **Time Synchronization:** The tracker uses `new Date().toISOString()` which uses the client's system clock in UTC. Ripple matches it with the Git log's UTC time. Ensure your server's clock is synced with NTP to prevent timezone offsets in geo-tracking records.
* **Double-Tracking in Local Dev:** In development, Ripple's script is injected on `localhost` dynamically. Ensure your project's inline tracker bridges calls to `window.Ripple` (if available) on localhost to avoid generating duplicate session records.
* **Database Size Limits:** The `analyze.py` script limits individual session storage in the compiled json file to avoid bloat (default `max_sessions_stored = 300` in config).
