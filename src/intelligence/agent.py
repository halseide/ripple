#!/usr/bin/env python3
"""
Ripple -- Intelligence Agent
==============================
Reads project analytics (sessions + deployment windows + goals) and generates
specific, grounded, goal-aware suggestions.

This is NOT a generic AI assistant. It does not hallucinate advice.
Every suggestion references a specific data point from the analytics:
  - a named commit hash
  - a measured engagement rate
  - a real navigation path
  - a specific event count
  - a before/after behavioral diff

Public API:
    run(analytics_data, output_dir) -> list[Suggestion]

Suggestion shape:
    {
        "id":           str   # unique slug, e.g. "example-project-2026-06-03-001"
        "project_key":  str
        "project_name": str
        "goal":         str   # the goal this suggestion addresses
        "priority":     str   # "high" | "medium" | "low"
        "type":         str   # "deployment_impact" | "engagement_gap" | "funnel_drop" | "goal_gap"
        "title":        str   # one-line headline
        "evidence":     str   # the specific data point that triggered this
        "suggestion":   str   # the actionable recommendation
        "commit":       str | None  # hash if deployment-related
        "generated_at": str
        "status":       str   # "open" | "acknowledged" | "acted_on" | "dismissed"
    }
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

def run(analytics_data: dict, output_dir: Path) -> list:
    """
    Generate suggestions for all projects in analytics_data.
    Writes data/ripple_suggestions.json and returns the suggestion list.
    """
    all_suggestions = []

    for project in analytics_data.get("projects", []):
        if "error" in project:
            continue
        suggestions = _analyze_project(project)
        all_suggestions.extend(suggestions)

    # Write output
    output = {
        "generated_at":      datetime.now(timezone.utc).isoformat(),
        "ripple_version":    "0.1.0",
        "total_suggestions": len(all_suggestions),
        "open":              sum(1 for s in all_suggestions if s["status"] == "open"),
        "suggestions":       all_suggestions,
    }

    out_path = Path(output_dir) / "ripple_suggestions.json"
    out_path.write_text(
        json.dumps(output, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    return all_suggestions


# ── Project-level analysis ───────────────────────────────────────────────────

def _analyze_project(project: dict) -> list:
    suggestions = []
    key         = project["project_key"]
    name        = project["project"]
    goals       = project.get("goals", [])
    windows     = project.get("deployment_windows", [])
    now_ts      = datetime.now(timezone.utc).timestamp()

    eng_rate    = project.get("engagement_rate_pct", 0)
    median_s    = project.get("duration", {}).get("median_seconds", 0)
    real_count  = project.get("real_user_count", 0)
    nav_paths   = project.get("navigation_paths", [])
    view_funnel = project.get("view_funnel", [])
    top_events  = project.get("top_events", [])
    breakdown   = project.get("classification_breakdown", {})

    counter = [0]

    def make_id():
        counter[0] += 1
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return f"{key}-{today}-{counter[0]:03d}"

    # ── 1. Deployment impact analysis ────────────────────────────────────────
    for window in windows:
        commit      = window["commit"]
        before      = window["before_count"]
        after       = window["after_count"]
        commit_ts   = commit.get("date_ts", 0)
        age_hours   = (now_ts - commit_ts) / 3600

        # Too new to measure — flag it
        if after == 0 and age_hours < RECENT_COMMIT_HOURS:
            suggestions.append(_suggestion(
                id_=make_id(),
                project_key=key,
                project_name=name,
                goal=_match_goal(goals, ["users", "user base", "grow", "audience"]),
                priority="medium",
                type_="deployment_impact",
                title=f"No sessions yet after '{commit['message_short'][:50]}'",
                evidence=(
                    f"Commit {commit['hash']} was deployed {age_hours:.0f}h ago "
                    f"({commit['date_display']}) with {commit['files_changed']} files changed "
                    f"(+{commit['insertions']}/-{commit['deletions']} lines). "
                    f"Zero sessions recorded since deployment."
                ),
                suggestion=(
                    "Share the link in your distribution channels to get real users onto "
                    "the new build. You need at least 10 sessions before before/after "
                    "behavioral diff is meaningful."
                ),
                commit=commit["hash"],
            ))

        # Before/after diff — enough data to compare
        elif before >= MIN_SESSIONS_FOR_DIFF and after >= MIN_SESSIONS_FOR_DIFF:
            delta = after - before
            direction = "up" if delta >= 0 else "down"
            pct_change = abs(delta / before * 100) if before > 0 else 0

            if pct_change >= 20:   # meaningful movement
                priority = "high" if pct_change >= 50 else "medium"
                suggestions.append(_suggestion(
                    id_=make_id(),
                    project_key=key,
                    project_name=name,
                    goal=_match_goal(goals, ["users", "user base", "grow"]),
                    priority=priority,
                    type_="deployment_impact",
                    title=(
                        f"Sessions went {direction} {pct_change:.0f}% after "
                        f"'{commit['message_short'][:45]}'"
                    ),
                    evidence=(
                        f"Commit {commit['hash']} ({commit['date_display']}): "
                        f"{before} sessions before vs {after} sessions after. "
                        f"{pct_change:.0f}% {'increase' if direction == 'up' else 'drop'}."
                    ),
                    suggestion=(
                        f"This commit had a measurable {'positive' if direction == 'up' else 'negative'} "
                        f"effect on traffic. "
                        + ("Investigate what in this commit drove the increase and double down."
                           if direction == "up" else
                           "Review what changed and consider reverting or patching the regression.")
                    ),
                    commit=commit["hash"],
                ))

        # Lots of before, zero after — possible regression
        elif before >= MIN_SESSIONS_FOR_DIFF and after == 0 and age_hours >= RECENT_COMMIT_HOURS:
            suggestions.append(_suggestion(
                id_=make_id(),
                project_key=key,
                project_name=name,
                goal=_match_goal(goals, ["users", "grow"]),
                priority="high",
                type_="deployment_impact",
                title=f"Traffic dropped to zero after '{commit['message_short'][:50]}'",
                evidence=(
                    f"Commit {commit['hash']} ({commit['date_display']}): "
                    f"{before} sessions before, 0 after ({age_hours:.0f}h ago). "
                    f"This is outside the 'too new to measure' window."
                ),
                suggestion=(
                    "Zero sessions after a >72h-old deployment is a serious signal. "
                    "Check if the site is accessible, links are live, and the page loads "
                    "without errors on mobile and desktop."
                ),
                commit=commit["hash"],
            ))

    # ── 2. Engagement gap ────────────────────────────────────────────────────
    if real_count >= 10 and eng_rate < ENGAGED_GOAL_PCT:
        gap = ENGAGED_GOAL_PCT - eng_rate
        # Find the most common path of non-engaged users
        bounce_count = breakdown.get("bounce", 0) + breakdown.get("glancer", 0)
        suggestions.append(_suggestion(
            id_=make_id(),
            project_key=key,
            project_name=name,
            goal=_match_goal(goals, ["engag", "session", "duration"]),
            priority="high" if gap > 20 else "medium",
            type_="engagement_gap",
            title=f"Engagement at {eng_rate}% -- goal is {ENGAGED_GOAL_PCT:.0f}%",
            evidence=(
                f"{real_count} real users analysed. {eng_rate}% engaged (triggered an "
                f"interaction event). {bounce_count} users bounced or glanced without "
                f"interacting. Goal: {ENGAGED_GOAL_PCT:.0f}%."
            ),
            suggestion=(
                f"The gap is {gap:.1f} points. Focus on the entry experience: "
                f"the first 10 seconds after page load determine whether a user "
                f"triggers an interaction. Review the most common single-view paths "
                f"and add a clearer call-to-action or auto-start mechanic."
            ),
            commit=None,
        ))

    # ── 3. Duration goal gap ─────────────────────────────────────────────────
    if real_count >= 10 and median_s < MEDIAN_DURATION_GOAL_S:
        gap_s = MEDIAN_DURATION_GOAL_S - median_s
        from analytics.session_analytics import fmt_duration
        suggestions.append(_suggestion(
            id_=make_id(),
            project_key=key,
            project_name=name,
            goal=_match_goal(goals, ["session", "duration", "60 second", "minute"]),
            priority="high" if gap_s > 30 else "medium",
            type_="goal_gap",
            title=f"Median session {fmt_duration(median_s)} -- goal is {fmt_duration(MEDIAN_DURATION_GOAL_S)}",
            evidence=(
                f"Median session duration across {real_count} real users is "
                f"{fmt_duration(median_s)}. Goal is {fmt_duration(MEDIAN_DURATION_GOAL_S)}. "
                f"Gap: {fmt_duration(gap_s)}."
            ),
            suggestion=(
                "To increase dwell time, extend the core gameplay or content loop. "
                "Look at the view funnel: which view has the highest exit rate? "
                "That is where users are leaving. Add content depth or a re-engagement "
                "hook at that specific point."
            ),
            commit=None,
        ))

    # ── 4. Funnel drop analysis ───────────────────────────────────────────────
    if view_funnel and real_count >= 10:
        for view in view_funnel:
            if view["visits"] < 5:
                continue
            exit_pct = view.get("exit_pct", 0)
            visit_pct = view.get("visit_pct", 0)
            if exit_pct >= FUNNEL_DROP_THRESHOLD and visit_pct >= 10:
                goal = _match_goal(goals, ["trivia", "swag", "engag", "session"])
                suggestions.append(_suggestion(
                    id_=make_id(),
                    project_key=key,
                    project_name=name,
                    goal=goal,
                    priority="medium",
                    type_="funnel_drop",
                    title=f"{exit_pct:.0f}% of users exit from '{view['view']}' view",
                    evidence=(
                        f"'{view['view']}' view: visited by {view['visit_pct']:.0f}% of real "
                        f"users ({view['visits']} visits), but {exit_pct:.0f}% exit from here. "
                        f"Average time spent: {view['avg_display']}."
                    ),
                    suggestion=(
                        f"High exit rate from '{view['view']}' with only "
                        f"{view['avg_display']} avg time suggests users aren't finding "
                        f"what they came for. Consider adding a visible next-action "
                        f"button, reducing friction, or surfacing a hook within the "
                        f"first {view['avg_display']} of this view."
                    ),
                    commit=None,
                ))

    # ── 5. Goal-specific: trivia reach ────────────────────────────────────────
    trivia_goal = _match_goal(goals, ["trivia"], exact=True)
    if trivia_goal:
        trivia_funnel = next((v for v in view_funnel if "trivia" in v["view"].lower()), None)
        if trivia_funnel:
            trivia_pct = trivia_funnel["visit_pct"]
            if trivia_pct < 50:
                suggestions.append(_suggestion(
                    id_=make_id(),
                    project_key=key,
                    project_name=name,
                    goal=trivia_goal,
                    priority="high" if trivia_pct < 25 else "medium",
                    type_="goal_gap",
                    title=f"Only {trivia_pct:.0f}% of users reach the trivia view (goal: 50%+)",
                    evidence=(
                        f"Trivia view visited by {trivia_funnel['visits']} users "
                        f"({trivia_pct:.0f}% of {real_count} real users). "
                        f"Average time in trivia: {trivia_funnel['avg_display']}."
                    ),
                    suggestion=(
                        "Trivia is deep in the funnel. Most users never get there. "
                        "Consider surfacing a trivia teaser or prompt on the entry view, "
                        "or reducing the number of steps needed to reach it. "
                        "A 'try trivia' button on the main screen could double reach."
                    ),
                    commit=None,
                ))

    # ── 6. Goal-specific: swag ────────────────────────────────────────────────
    swag_goal = _match_goal(goals, ["swag", "purchase", "store"], exact=True)
    if swag_goal:
        swag_event = next((e for e in top_events if "swag" in e["event"].lower()), None)
        swag_dismissed = next((e for e in top_events if "swag_dismissed" in e["event"].lower()), None)

        if swag_dismissed and (not swag_event or swag_dismissed["count"] > swag_event.get("count", 0)):
            suggestions.append(_suggestion(
                id_=make_id(),
                project_key=key,
                project_name=name,
                goal=swag_goal,
                priority="high",
                type_="goal_gap",
                title="Swag dismissed more than purchased",
                evidence=(
                    f"'swag_dismissed' event fired {swag_dismissed['count']} times. "
                    + (f"'swag_ordered' fired {swag_event['count']} times."
                       if swag_event else "No 'swag_ordered' events recorded at all.")
                ),
                suggestion=(
                    "Users are actively closing the swag prompt. This means they're "
                    "seeing it, but the timing or offer isn't right. Test: show the "
                    "swag prompt after a completed game (post 'jump_landed') rather "
                    "than proactively. Users who finish a game are warmer buyers."
                ),
                commit=None,
            ))

    return suggestions


# ── Helpers ───────────────────────────────────────────────────────────────────

def _suggestion(
    id_, project_key, project_name, goal, priority, type_,
    title, evidence, suggestion, commit
) -> dict:
    return {
        "id":           id_,
        "project_key":  project_key,
        "project_name": project_name,
        "goal":         goal or "General improvement",
        "priority":     priority,
        "type":         type_,
        "title":        title,
        "evidence":     evidence,
        "suggestion":   suggestion,
        "commit":       commit,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status":       "open",
    }


def _match_goal(goals: list, keywords: list, exact: bool = False) -> str:
    """Return the first goal string that contains any of the keywords (case-insensitive)."""
    for goal in goals:
        goal_lower = goal.lower()
        for kw in keywords:
            if kw.lower() in goal_lower:
                return goal
    return goals[0] if goals else ""


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    analytics_path = sys.argv[1] if len(sys.argv) > 1 else "data/project_analytics.json"
    output_dir     = sys.argv[2] if len(sys.argv) > 2 else "data"

    print(f"[Ripple Intelligence] Reading {analytics_path} ...")
    with open(analytics_path, encoding="utf-8") as f:
        analytics_data = json.load(f)

    suggestions = run(analytics_data, Path(output_dir))

    print(f"\n[Ripple Intelligence] {len(suggestions)} suggestions generated:\n")
    for s in suggestions:
        priority_icon = {"high": "[!]", "medium": "[~]", "low": "[ ]"}.get(s["priority"], "[ ]")
        print(f"  {priority_icon} [{s['type']}] {s['title']}")
        print(f"       Goal: {s['goal']}")
        print(f"       Why:  {s['evidence'][:120]}...")
        print(f"       Do:   {s['suggestion'][:120]}...")
        if s["commit"]:
            print(f"       Commit: {s['commit']}")
        print()

    print(f"[Ripple Intelligence] Written to {Path(output_dir) / 'ripple_suggestions.json'}")
