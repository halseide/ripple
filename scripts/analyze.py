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

    # Import the analytics module (extracted from Atlas2.0)
    from analytics import session_analytics

    # Build PROJECTS list from config format
    projects_cfg = []
    for p in config.get("projects", []):
        projects_cfg.append({
            "key":               p["key"],
            "name":              p["name"],
            "url":               p.get("url", ""),
            "sessions_dir":      p["sessions_dir"],
            "git_repo":          p.get("git_repo", ""),
            "interaction_events": p.get("interaction_events", []),
            "goals":             p.get("goals", []),
        })

    thresholds = config.get("thresholds", {})

    # Run analytics for each project
    results = []
    for proj in projects_cfg:
        print(f"\n  Analysing: {proj['name']} ...")
        result = session_analytics.parse_sessions(
            project=proj,
            min_duration_bot=thresholds.get("bot_max_duration_s", 2.0),
            max_duration_ghost=thresholds.get("ghost_min_duration_s", 300.0),
            max_sessions_stored=config.get("max_sessions_stored", 300),
        )
        results.append(result)

    output = {
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "ripple_version": "0.1.0",
        "projects": results,
    }

    out_path = output_dir / "project_analytics.json"
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[Ripple] Written to {out_path}")

    # TODO: Run intelligence layer → data/ripple_suggestions.json
    # from intelligence import agent
    # agent.run(results, projects_cfg, output_dir)

    print("[Ripple] Done. Open src/dashboard/index.html to view results.")


if __name__ == "__main__":
    main()
