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


def evaluate_goals(proj: dict, sessions: list, commits: list, config: dict) -> list:
    """
    Evaluates project goals.
    - Milestones: checks if a recent commit message contains the goal text (case-insensitive fuzzy match).
    - Metrics: parses '[Metric] view:X duration < Ys' or '[Metric] event:X conversion > Y%'
    """
    import re
    from datetime import datetime, timedelta, timezone

    # Resolve lookback window parameter
    # 1. Project level override, 2. Global config level, 3. Default to 7
    lookback_days = proj.get("lookback_days") or config.get("lookback_days", 7)
    
    # Filter sessions based on lookback window
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=float(lookback_days))
    
    recent_sessions = []
    for s in sessions:
        try:
            start_str = s.get("start", "") or s.get("startTime", "")
            if not start_str:
                continue
            if start_str.endswith("Z"):
                start_str = start_str[:-1] + "+00:00"
            dt = datetime.fromisoformat(start_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                recent_sessions.append(s)
        except Exception:
            pass

    evaluated = []
    
    for goal in proj.get("goals", []):
        goal_str = goal.strip()
        if not goal_str:
            continue
            
        if goal_str.lower().startswith("[metric]"):
            # It's a metric goal!
            # Example: [Metric] view:swag-store duration < 15s
            # Example: [Metric] event:order_clicked conversion > 10%
            metric_match = re.match(
                r"\[metric\]\s+(view|event):(\S+)\s+(duration|conversion)\s+([<>])\s+([\d.]+)(s|%)?",
                goal_str, re.IGNORECASE
            )
            if metric_match:
                target_type = metric_match.group(1).lower() # "view" or "event"
                target_name = metric_match.group(2)         # e.g., "swag-store"
                metric_type = metric_match.group(3).lower() # "duration" or "conversion"
                operator = metric_match.group(4)            # "<" or ">"
                target_val = float(metric_match.group(5))   # target value
                
                actual_val = None
                status = "pending"
                details = "No data found within the lookback window."
                
                if target_type == "view" and metric_type == "duration":
                    durations = []
                    for s in recent_sessions:
                        for v in s.get("views", []):
                            if v.get("view") == target_name:
                                durations.append(v.get("duration_s", 0))
                    
                    if durations:
                        actual_val = sum(durations) / len(durations)
                        passed = (actual_val < target_val) if operator == "<" else (actual_val > target_val)
                        status = "passed" if passed else "failing"
                        details = f"Average duration is {actual_val:.1f}s (Target: {operator} {target_val:.1f}s, based on {len(durations)} view visits over last {lookback_days} days)"
                    else:
                        details = f"No visits to view '{target_name}' in the last {lookback_days} days."
                        
                elif target_type == "event" and metric_type == "conversion":
                    total_sessions_count = len(recent_sessions)
                    matching_sessions_count = 0
                    for s in recent_sessions:
                        has_event = any(e.get("name") == target_name for e in s.get("events", []))
                        if has_event:
                            matching_sessions_count += 1
                            
                    if total_sessions_count > 0:
                        actual_val = (matching_sessions_count / total_sessions_count) * 100
                        passed = (actual_val < target_val) if operator == "<" else (actual_val > target_val)
                        status = "passed" if passed else "failing"
                        details = f"Conversion rate is {actual_val:.1f}% (Target: {operator} {target_val:.1f}%, based on {matching_sessions_count}/{total_sessions_count} sessions over last {lookback_days} days)"
                    else:
                        details = f"No sessions recorded in the last {lookback_days} days."
                else:
                    details = f"Unsupported metric syntax or type combination."
                
                evaluated.append({
                    "text": goal_str,
                    "type": "metric",
                    "status": status,
                    "details": details,
                    "target_type": target_type,
                    "target_name": target_name,
                    "metric_type": metric_type,
                    "operator": operator,
                    "target_value": target_val,
                    "actual_value": round(actual_val, 1) if actual_val is not None else None
                })
            else:
                evaluated.append({
                    "text": goal_str,
                    "type": "metric",
                    "status": "pending",
                    "details": "Invalid metric syntax. Expected format: [Metric] view:view_name duration < 15s or [Metric] event:event_name conversion > 10%"
                })
        else:
            # Milestone goal
            found_commit = None
            goal_words = set(re.findall(r"\w+", goal_str.lower()))
            
            for commit in commits:
                msg = commit.get("message", "").lower()
                if goal_str.lower() in msg:
                    found_commit = commit
                    break
                msg_words = set(re.findall(r"\w+", msg))
                if len(goal_words) >= 2 and goal_words.issubset(msg_words):
                    found_commit = commit
                    break
            
            if found_commit:
                evaluated.append({
                    "text": goal_str,
                    "type": "milestone",
                    "status": "completed",
                    "details": f"Resolved by commit {found_commit['hash']} ('{found_commit['message_short']}')"
                })
            else:
                evaluated.append({
                    "text": goal_str,
                    "type": "milestone",
                    "status": "pending",
                    "details": "No matching commit message found in git history."
                })
                
    return evaluated


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
            "lookback_days":      p.get("lookback_days"),
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
        real_sessions = [s for s in analytics.get("sessions", []) if not s.get("is_localhost", False)]
        windows = git_reader.build_deployment_windows(commits, real_sessions)

        if windows:
            print(f"    Windows:  {len(windows)} deployment windows computed")
            for w in windows[:3]:   # preview first 3
                print(f"      {w['commit']['hash']}  {w['commit']['date_display']}  "
                      f"before={w['before_count']} sessions  after={w['after_count']} sessions  "
                      f"'{w['commit']['message_short'][:50]}'")

        # 4. Compute A/B metrics for deployment windows
        interaction_events = set(proj["interaction_events"])
        for w in windows:
            for suffix in ["", "_3d"]:
                for side in ["before", "after"]:
                    sessions = w[f"sessions_{side}{suffix}"]
                    total = len(sessions)
                    metric_key = f"{side}{suffix}_metrics"
                    if total == 0:
                        w[metric_key] = {"bounce_pct": 0.0, "engaged_pct": 0.0, "real_users": 0, "median_ttfa": None}
                        continue
                    
                    bounces = 0
                    engaged = 0
                    bots = 0
                    
                    for s in sessions:
                        events = [e.get('name') for e in s.get('events', [])]
                        duration = s.get('duration_s', 0)
                        has_interaction = any(e in interaction_events for e in events)
                        
                        # Bots are handled earlier by session_analytics, but just in case:
                        if duration < 2.0:
                            bots += 1
                            continue
                            
                        if has_interaction:
                            engaged += 1
                        elif duration < 10:
                            bounces += 1
                            
                    real_users = total - bots
                    ttfas = sorted(s.get("ttfa_s") for s in sessions if s.get("ttfa_s") is not None)
                    median_ttfa = ttfas[len(ttfas) // 2] if ttfas else None

                    if real_users > 0:
                        w[metric_key] = {
                            "bounce_pct": round((bounces / real_users) * 100, 1),
                            "engaged_pct": round((engaged / real_users) * 100, 1),
                            "real_users": real_users,
                            "median_ttfa": round(median_ttfa, 1) if median_ttfa is not None else None
                        }
                    else:
                        w[metric_key] = {"bounce_pct": 0.0, "engaged_pct": 0.0, "real_users": 0, "median_ttfa": None}

        # 4.5 Evaluate goals
        analytics["goals_status"]        = evaluate_goals(proj, real_sessions, commits, config)

        # 5. Attach to result
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
        "ripple_version": config.get("version", "v0.3.0"),
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
