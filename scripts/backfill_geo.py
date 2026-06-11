#!/usr/bin/env python3
"""
backfill_geo.py

Scans all session files across Ripple-tracked projects and backfills
missing `geo` data with a stub so the analytics dashboard shows
'Unknown' instead of crashing on a missing key.

Usage:
    cd /path/to/ripple
    python scripts/backfill_geo.py

Rate-limit note:
    ip-api.com free tier allows 45 req/min. Since old sessions don't
    store the client IP outside of `geo.query`, we can't look it up
    retroactively. Instead we write a minimal stub object.
"""

import json
import os
import sys
import glob

GEO_STUB = {
    "status": "unknown",
    "country": "Unknown",
    "countryCode": "XX",
    "regionName": "Unknown",
    "city": "Unknown",
    "lat": 0,
    "lon": 0,
    "timezone": "Unknown",
    "isp": "Unknown",
    "org": "Unknown",
    "query": "0.0.0.0"
}


def load_config():
    """Load ripple.config.json from the current working directory."""
    config_path = os.path.join(os.getcwd(), "ripple.config.json")
    if not os.path.isfile(config_path):
        print(f"ERROR: Could not find ripple.config.json at {config_path}")
        print("       Run this script from the ripple project root.")
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def needs_geo(data):
    """Return True if the session data is missing or has empty/null geo."""
    geo = data.get("geo")
    if geo is None:
        return True
    if isinstance(geo, dict) and len(geo) == 0:
        return True
    return False


def backfill_project(sessions_dir):
    """
    Scan a single project's sessions directory.
    Returns (scanned, already_had, backfilled) counts.
    """
    scanned = 0
    already_had = 0
    backfilled = 0

    pattern = os.path.join(sessions_dir, "sess_*.json")
    files = glob.glob(pattern)

    for filepath in files:
        scanned += 1
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"  WARN: Skipping {os.path.basename(filepath)}: {e}")
            continue

        if not needs_geo(data):
            already_had += 1
            continue

        # Add the stub geo object
        data["geo"] = dict(GEO_STUB)  # shallow copy
        backfilled += 1

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        except IOError as e:
            print(f"  ERROR: Could not write {os.path.basename(filepath)}: {e}")
            backfilled -= 1  # don't count it

    return scanned, already_had, backfilled


def main():
    config = load_config()
    projects = config.get("projects", [])

    if not projects:
        print("No projects found in ripple.config.json.")
        sys.exit(0)

    total_scanned = 0
    total_already_had = 0
    total_backfilled = 0

    print(f"Backfilling geo data for {len(projects)} project(s)...\n")

    for project in projects:
        name = project.get("name", project.get("key", "unknown"))
        sessions_dir = project.get("sessions_dir", "")

        if not sessions_dir:
            print(f"  [{name}] No sessions_dir configured, skipping.")
            continue

        if not os.path.isdir(sessions_dir):
            print(f"  [{name}] Sessions dir not found: {sessions_dir}, skipping.")
            continue

        scanned, already_had, backfilled = backfill_project(sessions_dir)
        total_scanned += scanned
        total_already_had += already_had
        total_backfilled += backfilled

        print(f"  [{name}] {scanned} scanned, {already_had} already had geo, {backfilled} backfilled")

    print(f"\n{'='*50}")
    print(f"SUMMARY")
    print(f"  Files scanned:          {total_scanned}")
    print(f"  Already had geo:        {total_already_had}")
    print(f"  Backfilled with stub:   {total_backfilled}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
