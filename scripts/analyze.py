#!/usr/bin/env python3
"""
Ripple — analyze.py
====================
Main entry point for Ripple. Run this after downloading fresh session data.

Usage:
    python scripts/analyze.py                  # uses ripple.config.json in cwd
    python scripts/analyze.py --config path/to/ripple.config.json

What it does:
    1. Loads your ripple.config.json
    2. Reads session JSON files for each project
    3. Reads git log for deployment events
    4. Computes before/after behavioral diffs per commit
    5. Runs the intelligence layer (generates goal-aware suggestions)
    6. Writes output to data/project_analytics.json and data/ripple_suggestions.json
    7. Prints a summary to the terminal

Output is read by the Ripple dashboard (src/dashboard/index.html).
"""

import json
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Add src to path so we can import ripple modules
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


def load_config(config_path: str) -> dict:
    """Load and validate ripple.config.json."""
    path = Path(config_path)
    if not path.exists():
        print(f"[Ripple] Config not found: {config_path}")
        print(f"[Ripple] Copy examples/ripple.config.example.json to ripple.config.json and edit it.")
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        config = json.load(f)

    projects = config.get("projects", [])
    if not projects:
        print("[Ripple] No projects defined in config. Add at least one project.")
        sys.exit(1)

    return config


def main():
    parser = argparse.ArgumentParser(description="Ripple — analytics + deployment correlation")
    parser.add_argument("--config", default="ripple.config.json",
                        help="Path to ripple.config.json (default: ./ripple.config.json)")
    args = parser.parse_args()

    config = load_config(args.config)
    output_dir = Path(config.get("output_dir", "./data"))
    output_dir.mkdir(parents=True, exist_ok=True)

    # Import modules
    from analytics import session_analytics
    from git import git_reader

    # Build PROJECTS list from config format
    projects_cfg = []
    for p in config.get("projects", []):
        projects_cfg.append({
            "key":                p["key"],
            "name":               p["name"],
            "url":                p.get("url", ""),
            "sessions_dir":       p["sessions_dir"],
            "git_repo":           p.get("git_repo", ""),
            "interaction_events": p.get("interaction_events", []),
            "goals":              p.get("goals", []),
        })

    thresholds = config.get("thresholds", {})

    # ── Run analytics + git correlation for each project ──────────────────────
    results = []
    for proj in projects_cfg:
        print(f"\n  [{proj['name']}] Analysing sessions ...")

        # 1. Session analytics
        analytics = session_analytics.parse_sessions(
            project=proj,
            min_duration_bot=thresholds.get("bot_max_duration_s", 2.0),
            max_duration_ghost=thresholds.get("ghost_min_duration_s", 300.0),
            max_sessions_stored=config.get("max_sessions_stored", 300),
        )

        if "error" in analytics:
            print(f"    ERR {analytics['error']}")
            error_msg = analytics["error"]
            analytics = {
                "project_key": proj["key"],
                "project": proj["name"],
                "url": proj["url"],
                "goals": proj["goals"],
                "real_user_count": 0,
                "total_raw": 0,
                "engagement_rate_pct": 0.0,
                "duration": {"median_seconds": 0, "median_display": "0s"},
                "classification_breakdown": {},
                "navigation_paths": [],
                "view_funnel": [],
                "top_events": [],
                "sessions": [],
                "error": error_msg
            }
        else:
            ru  = analytics["real_user_count"]
            tot = analytics["total_raw"]
            eng = analytics["engagement_rate_pct"]
            med = analytics["duration"]["median_display"]
            np_ = len(analytics["navigation_paths"])
            print(f"    Sessions: {ru}/{tot} real users | {eng}% engaged | median {med} | {np_} paths")

        # 2. Git log
        print(f"  [{proj['name']}] Reading git log ...")
        commits = git_reader.get_commits(
            repo_path=proj["git_repo"],
            n=config.get("max_commits", 50),
        )

        if commits:
            print(f"    Commits:  {len(commits)} found — latest: '{commits[0]['message_short']}' ({commits[0]['date_display']})")
        else:
            print(f"    Commits:  none found (git_repo not set or empty repo)")

        # 3. Build deployment windows (before/after behavioral diff per commit)
        real_sessions = [s for s in analytics.get("sessions", [])]
        windows = git_reader.build_deployment_windows(commits, real_sessions)

        if windows:
            print(f"    Windows:  {len(windows)} deployment windows computed")
            for w in windows[:3]:   # preview first 3
                print(f"      {w['commit']['hash']}  {w['commit']['date_display']}  "
                      f"before={w['before_count']} sessions  after={w['after_count']} sessions  "
                      f"'{w['commit']['message_short'][:50]}'")

        # 4. Attach to result
        analytics["commits"]             = commits
        analytics["deployment_windows"]  = windows

        results.append(analytics)

    # Load visitor names lookup table
    visitor_names_path = output_dir / "visitor_names.json"
    visitor_names = {}
    if visitor_names_path.exists():
        try:
            with open(visitor_names_path, "r", encoding="utf-8") as f:
                visitor_names = json.load(f)
        except Exception as e:
            print(f"[Ripple] Warning: Failed to load visitor_names.json: {e}")
    else:
        try:
            visitor_names_path.write_text(json.dumps({}, indent=2), encoding="utf-8")
        except Exception:
            pass

    # ── Write project_analytics.json ──────────────────────────────────────────
    output = {
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "ripple_version": "0.1.0",
        "projects":       results,
        "visitor_names":  visitor_names
    }

    out_path = output_dir / "project_analytics.json"
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[Ripple] Analytics written to {out_path}")

    # ── Intelligence layer ───────────────────────────────────────────────────
    from intelligence import agent
    suggestions = agent.run(output, output_dir)
    print(f"[Ripple] {len(suggestions)} suggestions written to {output_dir / 'ripple_suggestions.json'}")

    print("[Ripple] Done.")


if __name__ == "__main__":
    main()
