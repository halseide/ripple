#!/usr/bin/env python3
"""
Ripple -- Intelligence Agent
==============================
Reads project analytics (sessions + deployment windows + goals) and evaluates
the project state, writing observations directly into prompt_log.json.

This is NOT a generic AI assistant. It does not hallucinate advice.
Every observation references a specific data point from the analytics:
  - a named commit hash
  - a measured engagement rate
  - a real navigation path
  - a specific event count
  - a before/after behavioral diff

Public API:
    run(analytics_data, output_dir, *, prompt_log) -> list[PromptLogEntry]

The agent does TWO things:
  1. For each open `category: "goal"` prompt, evaluates progress and updates
     the `answer` and `answeredAt` fields IN PLACE on the existing entry.
  2. For anomaly observations (engagement drops, funnel issues, etc.), creates
     NEW entries in prompt_log with `category: "data"` and
     `subtype: "agent_observation"`.

Returns the updated prompt_log array. Does NOT write ripple_suggestions.json.
"""

import json
from datetime import datetime, timezone
from pathlib import Path


# ── Thresholds (tunable) ─────────────────────────────────────────────────────
ENGAGED_GOAL_PCT       = 80.0   # target engagement rate
MEDIAN_DURATION_GOAL_S = 60.0   # target median session (seconds)
FUNNEL_DROP_THRESHOLD  = 40.0   # if a view loses >40% of visitors it entered with, flag it
MIN_SESSIONS_FOR_DIFF  = 5      # minimum sessions in a window to make a before/after claim
RECENT_COMMIT_HOURS    = 72     # commits newer than this are "too new to measure"


# ── Main entry point ─────────────────────────────────────────────────────────

def run(analytics_data: dict, output_dir: Path, *, prompt_log: list = None) -> list:
    """
    Evaluate all projects in analytics_data. Updates prompt_log in-place:
      - Goal entries: updates `answer` and `answeredAt` with data-backed assessment
      - Anomaly observations: creates new `category: "data"` entries

    Returns the updated prompt_log array.
    """
    if prompt_log is None:
        prompt_log = []

    now_iso = datetime.now(timezone.utc).isoformat()

    # Collect existing agent observation IDs to avoid duplicates within a single run
    existing_obs_ids = {p.get("promptId") for p in prompt_log
                        if p.get("subtype") == "agent_observation"}

    for project in analytics_data.get("projects", []):
        if "error" in project:
            continue

        key = project["project_key"]

        # 1. Evaluate open goals in prompt_log
        _evaluate_goals(prompt_log, project, now_iso)

        # 2. Generate anomaly observations
        observations = _detect_anomalies(project)
        for obs in observations:
            if obs["promptId"] not in existing_obs_ids:
                prompt_log.append(obs)
                existing_obs_ids.add(obs["promptId"])

    return prompt_log


# ── Goal evaluation (updates entries in-place) ───────────────────────────────

def _evaluate_goals(prompt_log: list, project: dict, now_iso: str):
    """Find open goal prompts for this project and update their answer fields."""
    key = project["project_key"]

    eng_rate    = project.get("engagement_rate_pct", 0)
    median_s    = project.get("duration", {}).get("median_seconds", 0)
    real_count  = project.get("real_user_count", 0)
    view_funnel = project.get("view_funnel", [])
    top_events  = project.get("top_events", [])

    for entry in prompt_log:
        if (entry.get("category") != "goal"
                or entry.get("projectKey") != key
                or entry.get("status") not in ("pending", "open", "answered")):
            continue

        prompt_text = entry.get("prompt", "")
        evidence_parts = []

        # Check engagement-related keywords
        if any(kw in prompt_text.lower() for kw in ['engag', 'interact', 'session duration', 'duration']):
            evidence_parts.append(f"Current engagement: {eng_rate}%, median session: {median_s:.0f}s")
            if eng_rate < ENGAGED_GOAL_PCT:
                evidence_parts.append(f"Gap to {ENGAGED_GOAL_PCT:.0f}% target: {ENGAGED_GOAL_PCT - eng_rate:.1f} points")

        # Check user/growth keywords
        if any(kw in prompt_text.lower() for kw in ['user', 'grow', 'traffic', 'audience', 'active']):
            evidence_parts.append(f"Current real users in dataset: {real_count}")

        # Check specific views
        for vf in view_funnel:
            if vf['view'].lower() in prompt_text.lower():
                evidence_parts.append(
                    f"'{vf['view']}' view: {vf['visit_pct']}% reach, "
                    f"{vf.get('entry_pct', 0)}% start here, "
                    f"{vf['exit_pct']}% exit, avg {vf['avg_display']}"
                )

        # Check specific events
        for te in top_events:
            if te['event'].lower() in prompt_text.lower():
                evidence_parts.append(f"'{te['event']}' event: {te['count']} occurrences")

        # Write assessment
        if evidence_parts:
            assessment = "Agent evaluation: " + "; ".join(evidence_parts) + "."
        else:
            assessment = (
                f"Agent evaluation: No specific metrics matched for this goal. "
                f"General state — {real_count} real users, {eng_rate}% engaged, "
                f"median session {median_s:.0f}s."
            )

        entry["answer"] = assessment
        entry["answeredAt"] = now_iso
        if entry.get("status") == "pending":
            entry["status"] = "answered"


# ── Anomaly detection (creates new entries) ──────────────────────────────────

def _detect_anomalies(project: dict) -> list:
    """Detect anomalies and return new prompt_log entries for them."""
    observations = []
    key         = project["project_key"]
    name        = project.get("project", key)
    now_ts      = datetime.now(timezone.utc).timestamp()
    now_iso     = datetime.now(timezone.utc).isoformat()
    today       = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    eng_rate    = project.get("engagement_rate_pct", 0)
    median_s    = project.get("duration", {}).get("median_seconds", 0)
    real_count  = project.get("real_user_count", 0)
    view_funnel = project.get("view_funnel", [])
    windows     = project.get("deployment_windows", [])
    breakdown   = project.get("classification_breakdown", {})

    counter = [0]

    def make_id():
        counter[0] += 1
        return f"agent_obs_{key}_{today}_{counter[0]:03d}"

    def make_entry(prompt_id, title, evidence):
        return {
            "promptId":        prompt_id,
            "projectKey":      key,
            "pageUrl":         project.get("url", ""),
            "elementSelector": "project-level",
            "elementContext":  f"Agent observation for {name}",
            "category":        "data",
            "subtype":         "agent_observation",
            "prompt":          title,
            "sessionId":       "agent",
            "timestamp":       now_iso,
            "capturedAt":      now_iso,
            "status":          "answered",
            "commitHash":      "",
            "commitMessage":   "",
            "answer":          evidence,
            "answeredAt":      now_iso,
            "reply":           "",
            "repliedAt":       "",
        }

    # ── 1. Deployment impact ──────────────────────────────────────────────────
    for window in windows:
        commit      = window["commit"]
        before      = window["before_count"]
        after       = window["after_count"]
        commit_ts   = commit.get("date_ts", 0)
        age_hours   = (now_ts - commit_ts) / 3600

        # No sessions after recent deploy
        if after == 0 and age_hours < RECENT_COMMIT_HOURS:
            observations.append(make_entry(
                make_id(),
                f"No sessions yet after '{commit['message_short'][:50]}'",
                f"Commit {commit['hash']} was deployed {age_hours:.0f}h ago "
                f"({commit['date_display']}) with {commit['files_changed']} files changed "
                f"(+{commit['insertions']}/-{commit['deletions']} lines). "
                f"Zero sessions recorded since deployment. Share the link to get real users."
            ))

        # Significant before/after diff
        elif before >= MIN_SESSIONS_FOR_DIFF and after >= MIN_SESSIONS_FOR_DIFF:
            delta = after - before
            direction = "up" if delta >= 0 else "down"
            pct_change = abs(delta / before * 100) if before > 0 else 0

            if pct_change >= 20:
                observations.append(make_entry(
                    make_id(),
                    f"Sessions went {direction} {pct_change:.0f}% after '{commit['message_short'][:45]}'",
                    f"Commit {commit['hash']} ({commit['date_display']}): "
                    f"{before} sessions before vs {after} sessions after. "
                    f"{pct_change:.0f}% {'increase' if direction == 'up' else 'drop'}. "
                    f"{'Investigate what drove the increase.' if direction == 'up' else 'Review and consider reverting.'}"
                ))

        # Traffic dropped to zero
        elif before >= MIN_SESSIONS_FOR_DIFF and after == 0 and age_hours >= RECENT_COMMIT_HOURS:
            observations.append(make_entry(
                make_id(),
                f"Traffic dropped to zero after '{commit['message_short'][:50]}'",
                f"Commit {commit['hash']} ({commit['date_display']}): "
                f"{before} sessions before, 0 after ({age_hours:.0f}h ago). "
                f"Check if the site is accessible and links are live."
            ))

    # ── 2. Engagement gap ────────────────────────────────────────────────────
    if real_count >= 10 and eng_rate < ENGAGED_GOAL_PCT:
        gap = ENGAGED_GOAL_PCT - eng_rate
        bounce_count = breakdown.get("bounce", 0) + breakdown.get("glancer", 0)
        observations.append(make_entry(
            make_id(),
            f"Engagement at {eng_rate}% — goal is {ENGAGED_GOAL_PCT:.0f}%",
            f"{real_count} real users analysed. {eng_rate}% engaged. "
            f"{bounce_count} users bounced or glanced without interacting. "
            f"Gap: {gap:.1f} points. Focus on the entry experience."
        ))

    # ── 3. Duration goal gap ─────────────────────────────────────────────────
    if real_count >= 10 and median_s < MEDIAN_DURATION_GOAL_S:
        gap_s = MEDIAN_DURATION_GOAL_S - median_s
        observations.append(make_entry(
            make_id(),
            f"Median session {median_s:.0f}s — goal is {MEDIAN_DURATION_GOAL_S:.0f}s",
            f"Median session duration across {real_count} real users is {median_s:.0f}s. "
            f"Goal is {MEDIAN_DURATION_GOAL_S:.0f}s. Gap: {gap_s:.0f}s. "
            f"Look at the view funnel for the highest exit-rate view."
        ))

    # ── 4. Funnel drop analysis ──────────────────────────────────────────────
    if view_funnel and real_count >= 10:
        for view in view_funnel:
            if view["visits"] < 5:
                continue
            exit_pct = view.get("exit_pct", 0)
            visit_pct = view.get("visit_pct", 0)
            if exit_pct >= FUNNEL_DROP_THRESHOLD and visit_pct >= 10:
                observations.append(make_entry(
                    make_id(),
                    f"{exit_pct:.0f}% of users exit from '{view['view']}' view",
                    f"'{view['view']}' view: visited by {view['visit_pct']:.0f}% of real "
                    f"users ({view['visits']} visits), {exit_pct:.0f}% exit here. "
                    f"Avg time: {view['avg_display']}. Add a visible next-action or reduce friction."
                ))

    return observations


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    analytics_path = sys.argv[1] if len(sys.argv) > 1 else "data/project_analytics.json"
    output_dir     = sys.argv[2] if len(sys.argv) > 2 else "data"

    print(f"[Ripple Intelligence] Reading {analytics_path} ...")
    with open(analytics_path, encoding="utf-8") as f:
        analytics_data = json.load(f)

    prompt_log_path = Path(output_dir) / "prompt_log.json"
    prompt_log = json.loads(prompt_log_path.read_text(encoding="utf-8")) if prompt_log_path.exists() else []

    updated_log = run(analytics_data, Path(output_dir), prompt_log=prompt_log)

    # Write updated prompt log
    prompt_log_path.write_text(
        json.dumps(updated_log, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    goals_updated = sum(1 for p in updated_log if p.get("category") == "goal"
                        and p.get("answeredAt"))
    observations = sum(1 for p in updated_log if p.get("subtype") == "agent_observation")

    print(f"\n[Ripple Intelligence] {goals_updated} goal(s) evaluated, "
          f"{observations} observation(s) in prompt_log")
    print(f"[Ripple Intelligence] Written to {prompt_log_path}")
