#!/usr/bin/env python3
"""
Session Analytics Skill
=======================
Reusable analytics engine for vibe-coded projects that track session JSON files.
Filters out bots, ghost sessions, and pure bounces to surface only "real" users.
Outputs navigation paths, view funnels, and session-level detail for drill-down.

Usage:
    python scripts/session_analytics.py

Config is set per-project in PROJECTS list below.
Output: [WEB_ROOT]\\project-alpha\\data\\project_analytics.json
"""

import json
import os
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from urllib.parse import urlparse

# ── Project Registry ──────────────────────────────────────────────────────────
PROJECTS = [
    {
        "key": "example",
        "name": "example.com",
        "url": "https://example.com",
        "sessions_dir": r"[WEB_ROOT]\example.com\sessions",
        "git_repo":     r"[WEB_ROOT]\example.com",   # optional: path to local git repo
        "interaction_events": [
            "game_started", "jump_initiated", "jump_landed",
            "view_switched", "chat_sent", "swag_ordered",
            "trivia_loaded", "modal_opened",
        ],
    },
    # Add future projects here:
    # {
    #     "key": "project-beta",
    #     "name": "Handshake CRM",
    #     "url": "http://localhost/project-beta/",
    #     "sessions_dir": r"[WEB_ROOT]\project-beta\sessions",
    #     "git_repo":     r"[WEB_ROOT]\project-beta",
    #     "interaction_events": ["contact_viewed", "pitch_submitted", "filter_applied"],
    # },
]

OUTPUT_PATH = Path(r"[WEB_ROOT]\project-alpha\data\project_analytics.json")

# ── Thresholds ────────────────────────────────────────────────────────────────
MIN_DURATION_BOT   = 2.0    # < 2s  → bot / bad load
MAX_DURATION_GHOST = 300.0  # > 5min with no interaction → ghost tab
MAX_SESSIONS_STORED = 300   # max individual session records in output


# ── Deployment History from Git ────────────────────────────────────────────────────────────────

def get_deployments(git_repo: str, n: int = 20) -> list:
    """
    Read the last N commits from a git repo.
    Returns list of {hash, date_iso, message, date_display}.
    Used to overlay deployment markers on the analytics timeline.
    """
    if not git_repo or not Path(git_repo).exists():
        return []
    try:
        result = subprocess.run(
            ["git", "-C", git_repo, "log", f"-{n}",
             "--format=%H\x1f%aI\x1f%s"],
            capture_output=True, text=True, timeout=5
        )
        deployments = []
        for line in result.stdout.strip().splitlines():
            parts = line.split("\x1f", 2)
            if len(parts) == 3:
                h, date_iso, msg = parts
                try:
                    dt = datetime.fromisoformat(date_iso)
                    deployments.append({
                        "hash":         h[:8],
                        "hash_full":    h,
                        "date_iso":     dt.astimezone(timezone.utc).isoformat(),
                        "date_display": dt.strftime("%b %d, %H:%M"),
                        "message":      msg.strip(),
                    })
                except Exception:
                    pass
        return deployments
    except Exception:
        return []


def sessions_in_window(real_sessions: list, after_iso: str, before_iso: str | None) -> dict:
    """
    Given a time window, compute key metrics for real sessions that started in that window.
    Used to produce before/after stats for each deployment.
    """
    after_dt  = datetime.fromisoformat(after_iso)
    before_dt = datetime.fromisoformat(before_iso) if before_iso else datetime.now(timezone.utc)

    window = []
    for s in real_sessions:
        try:
            dt = datetime.fromisoformat(s.get("startTime", "").replace("Z", "+00:00"))
            if after_dt <= dt < before_dt:
                window.append(s)
        except Exception:
            pass

    if not window:
        return {"count": 0}

    durs = sorted(s.get("totalDurationSeconds", 0) for s in window)
    median_dur = durs[len(durs) // 2]

    # Path distribution
    path_counts = defaultdict(int)
    for s in window:
        path_counts[session_path(s)] += 1
    top_paths = sorted(path_counts.items(), key=lambda x: -x[1])[:5]

    return {
        "count":           len(window),
        "median_duration": round(median_dur, 1),
        "median_display":  _fmt(median_dur),
        "top_paths":       [{"path": p, "count": c} for p, c in top_paths],
    }


# ── Classification ────────────────────────────────────────────────────────────

def classify_session(sess: dict, interaction_events: list) -> str:
    duration = sess.get("totalDurationSeconds", 0)
    event_names = [e["name"] for e in sess.get("events", [])]
    has_interaction = any(e in interaction_events for e in event_names)

    if duration < MIN_DURATION_BOT:
        return "bot"
    if not has_interaction:
        if duration > MAX_DURATION_GHOST:
            return "ghost"
        if duration < 10:
            return "bounce"
        return "glancer"
    if duration >= 60:
        return "deep"
    return "engaged"


def is_real_user(cls: str) -> bool:
    return cls in ("glancer", "engaged", "deep")


def referrer_label(raw: str) -> str:
    if not raw or raw == "direct":
        return "direct"
    try:
        netloc = urlparse(raw).netloc.replace("www.", "")
        return netloc or raw
    except Exception:
        return raw


def device_type(ua: str) -> str:
    ua = ua or ""
    if "Mobile" in ua or "Android" in ua:
        return "mobile"
    return "desktop"


# ── Path helpers ──────────────────────────────────────────────────────────────

def session_path(sess: dict) -> str:
    views = sess.get("views", [])
    if not views:
        return "(no views)"
    parts = []
    for v in views:
        name = v.get("view", "?")
        if not parts or parts[-1] != name:   # deduplicate consecutive repeats
            parts.append(name)
    return " → ".join(parts)


# ── Main parse ────────────────────────────────────────────────────────────────

def parse_sessions(project: dict) -> dict:
    sessions_dir = Path(project["sessions_dir"])
    interaction_events = project["interaction_events"]

    if not sessions_dir.exists():
        return {"error": f"Sessions dir not found: {sessions_dir}"}

    raw_sessions = []
    for f in sorted(sessions_dir.glob("sess_*.json")):
        try:
            with open(f) as fh:
                raw_sessions.append(json.load(fh))
        except Exception:
            pass

    if not raw_sessions:
        return {"error": "No session files found"}

    # ── Classify ──────────────────────────────────────────────────────────────
    classified = [(classify_session(s, interaction_events), s) for s in raw_sessions]
    total_raw  = len(classified)
    counts     = defaultdict(int)
    for c, _ in classified:
        counts[c] += 1

    real_sessions     = [s for c, s in classified if is_real_user(c)]
    real_count        = len(real_sessions)
    human_sessions    = [s for c, s in classified if c != "bot"]
    engaged_sessions  = [s for c, s in classified if c in ("engaged", "deep")]
    engagement_rate   = (len(engaged_sessions) / len(human_sessions) * 100) if human_sessions else 0

    # ── Duration stats ────────────────────────────────────────────────────────
    durations = sorted(s.get("totalDurationSeconds", 0) for s in real_sessions)
    if durations:
        mean_dur   = sum(durations) / len(durations)
        median_dur = durations[len(durations) // 2]
        p75_dur    = durations[int(len(durations) * 0.75)]
    else:
        mean_dur = median_dur = p75_dur = 0

    # ── Referrers ─────────────────────────────────────────────────────────────
    ref_counts = defaultdict(int)
    for s in real_sessions:
        ref_counts[referrer_label(s.get("referrer", "") or "direct")] += 1
    top_referrers = [{"source": r, "count": c}
                     for r, c in sorted(ref_counts.items(), key=lambda x: -x[1])[:10]]

    # ── Device split ──────────────────────────────────────────────────────────
    mobile_count  = sum(1 for s in real_sessions if device_type(s.get("userAgent","")) == "mobile")
    desktop_count = real_count - mobile_count

    # ── Hourly chart ──────────────────────────────────────────────────────────
    hourly = defaultdict(int)
    for s in real_sessions:
        try:
            dt = datetime.fromisoformat(s["startTime"].replace("Z", "+00:00"))
            hourly[dt.hour] += 1
        except Exception:
            pass
    hourly_chart = [hourly.get(h, 0) for h in range(24)]

    # ── Daily trend (last 30 days) ────────────────────────────────────────────
    daily = defaultdict(int)
    for s in real_sessions:
        try:
            dt = datetime.fromisoformat(s["startTime"].replace("Z", "+00:00"))
            daily[dt.strftime("%Y-%m-%d")] += 1
        except Exception:
            pass
    daily_trend = dict(sorted(daily.items())[-30:])

    # ── Event frequency ───────────────────────────────────────────────────────
    event_counts = defaultdict(int)
    for s in real_sessions:
        for e in s.get("events", []):
            event_counts[e["name"]] += 1
    top_events = [{"event": e, "count": c}
                  for e, c in sorted(event_counts.items(), key=lambda x: -x[1])[:15]]

    # ── Jump outcomes ─────────────────────────────────────────────────────────
    jump_outcomes = defaultdict(int)
    for s in real_sessions:
        for e in s.get("events", []):
            if e["name"] == "jump_landed":
                d = e.get("details", {})
                if isinstance(d, dict):
                    jump_outcomes[d.get("conclusion", "unknown")] += 1

    # ── Navigation Paths ──────────────────────────────────────────────────────
    path_sessions = defaultdict(list)   # path_str → [session_ids]
    path_durations = defaultdict(list)  # path_str → [total_duration_s]

    for s in real_sessions:
        p = session_path(s)
        sid = s.get("sessionId", "?")
        path_sessions[p].append(sid)
        path_durations[p].append(s.get("totalDurationSeconds", 0))

    navigation_paths = []
    for path_str, sids in sorted(path_sessions.items(), key=lambda x: -len(x[1])):
        durs = path_durations[path_str]
        avg_dur = sum(durs) / len(durs) if durs else 0
        navigation_paths.append({
            "path":         path_str,
            "count":        len(sids),
            "pct":          round(len(sids) / real_count * 100, 1) if real_count else 0,
            "avg_duration": round(avg_dur, 1),
            "avg_display":  _fmt(avg_dur),
            "session_ids":  sids,
        })

    # ── View Funnel ───────────────────────────────────────────────────────────
    # Order views by how commonly they appear as the FIRST view visited
    first_view_counts = defaultdict(int)
    view_visit_counts = defaultdict(int)
    view_durations    = defaultdict(list)
    view_exit_counts  = defaultdict(int)   # sessions where this was the LAST view

    for s in real_sessions:
        views = s.get("views", [])
        if not views:
            continue
        first_view_counts[views[0].get("view", "?")] += 1
        seen_in_session = set()
        for i, v in enumerate(views):
            vname = v.get("view", "?")
            if vname not in seen_in_session:
                view_visit_counts[vname] += 1
                seen_in_session.add(vname)
            view_durations[vname].append(v.get("durationSeconds", 0))
        # last view = where they exited
        last_v = views[-1].get("view", "?")
        view_exit_counts[last_v] += 1

    all_view_names = sorted(
        view_visit_counts.keys(),
        key=lambda v: -view_visit_counts[v]
    )

    view_funnel = []
    for vname in all_view_names:
        durs = view_durations[vname]
        avg_d = sum(durs) / len(durs) if durs else 0
        visits = view_visit_counts[vname]
        exits  = view_exit_counts.get(vname, 0)
        view_funnel.append({
            "view":           vname,
            "visits":         visits,
            "visit_pct":      round(visits / real_count * 100, 1) if real_count else 0,
            "avg_duration":   round(avg_d, 1),
            "avg_display":    _fmt(avg_d),
            "exit_count":     exits,
            "exit_pct":       round(exits / visits * 100, 1) if visits else 0,
        })

    # ── Individual Session Records (for drill-down, most recent first) ────────
    cls_map = {s.get("sessionId"): c for c, s in classified}
    session_records = []
    for s in sorted(real_sessions,
                    key=lambda x: x.get("startTime", ""), reverse=True)[:MAX_SESSIONS_STORED]:
        sid = s.get("sessionId", "?")
        ua  = s.get("userAgent", "")
        event_names = [e["name"] for e in s.get("events", [])]
        session_records.append({
            "id":           sid,
            "start":        s.get("startTime", ""),
            "duration_s":   round(s.get("totalDurationSeconds", 0), 1),
            "duration":     _fmt(s.get("totalDurationSeconds", 0)),
            "classification": cls_map.get(sid, "?"),
            "referrer":     referrer_label(s.get("referrer", "") or "direct"),
            "device":       device_type(ua),
            "browser":      _parse_browser(ua),
            "path":         session_path(s),
            "views":        [
                {
                    "view": v.get("view", "?"),
                    "duration_s": round(v.get("durationSeconds", 0), 1),
                    "duration":   _fmt(v.get("durationSeconds", 0)),
                }
                for v in s.get("views", [])
            ],
            "events":       [
                {
                    "name":      e.get("name", "?"),
                    "timestamp": e.get("timestamp", ""),
                    "details":   e.get("details"),
                }
                for e in s.get("events", [])
                if e.get("name") not in ("visibility_change",)
            ],
        })

    return {
        "project":          project["name"],
        "project_key":      project["key"],
        "url":              project["url"],
        "generated_at":     datetime.now(timezone.utc).isoformat(),
        "total_raw":        total_raw,
        "real_user_count":  real_count,
        "classification_breakdown": dict(counts),
        "bot_rate_pct":     round(counts["bot"] / total_raw * 100, 1) if total_raw else 0,
        "ghost_rate_pct":   round(counts["ghost"] / total_raw * 100, 1) if total_raw else 0,
        "engagement_rate_pct": round(engagement_rate, 1),
        "duration": {
            "mean_seconds":   round(mean_dur, 1),
            "median_seconds": round(median_dur, 1),
            "p75_seconds":    round(p75_dur, 1),
            "mean_display":   _fmt(mean_dur),
            "median_display": _fmt(median_dur),
            "p75_display":    _fmt(p75_dur),
        },
        "device": {"mobile": mobile_count, "desktop": desktop_count},
        "top_referrers":    top_referrers,
        "top_events":       top_events,
        "hourly_chart":     hourly_chart,
        "daily_trend":      daily_trend,
        "jump_outcomes":    dict(jump_outcomes) if jump_outcomes else None,
        "navigation_paths": navigation_paths,
        "view_funnel":      view_funnel,
        "sessions":         session_records,
        "deployments":      _build_deployment_impact(project, real_sessions),
    }


def _build_deployment_impact(project: dict, real_sessions: list) -> list:
    """
    Fetch git commits for this project and compute before/after session metrics
    for each deployment. Returns deployments newest-first with impact stats.
    """
    git_repo = project.get("git_repo")
    commits  = get_deployments(git_repo)
    if not commits:
        return []

    result = []
    for i, commit in enumerate(commits):
        after_iso  = commit["date_iso"]
        # "before" = the next older commit's date (or None = all prior time)
        before_iso = commits[i - 1]["date_iso"] if i > 0 else None

        after_stats  = sessions_in_window(real_sessions, after_iso, None)
        # before: from prior commit up to this one
        if i < len(commits) - 1:
            before_stats = sessions_in_window(
                real_sessions, commits[i + 1]["date_iso"], after_iso
            )
        else:
            before_stats = {"count": 0}

        result.append({
            **commit,
            "sessions_after":  after_stats,
            "sessions_before": before_stats,
        })

    return result



def _fmt(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}m {s}s"


def _parse_browser(ua: str) -> str:
    ua = ua or ""
    if "Snapchat" in ua:   return "Snapchat"
    if "Instagram" in ua:  return "Instagram"
    if "FBAN" in ua:       return "Facebook"
    if "TikTok" in ua:     return "TikTok"
    if "EdgA" in ua or "Edg/" in ua: return "Edge"
    if "Chrome" in ua and "Safari" in ua: return "Chrome"
    if "Firefox" in ua:    return "Firefox"
    if "Safari" in ua:     return "Safari"
    return "Other"


def main():
    all_projects = []
    for project in PROJECTS:
        print(f"  Analysing: {project['name']} ...")
        stats = parse_sessions(project)
        all_projects.append(stats)

        if "error" not in stats:
            ru  = stats["real_user_count"]
            tot = stats["total_raw"]
            eng = stats["engagement_rate_pct"]
            med = stats["duration"]["median_display"]
            np  = len(stats["navigation_paths"])
            print(f"    OK {ru}/{tot} real users | {eng}% engaged | median {med} | {np} unique paths")
        else:
            print(f"    ERR {stats['error']}")

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "projects": all_projects,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"  >> Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
