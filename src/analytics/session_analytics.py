#!/usr/bin/env python3
"""
Ripple — Session Analytics Engine
===================================
Generic session classification and analysis for any project that records
sessions as JSON files.

This module is config-driven. It does NOT contain any project-specific
paths, keys, or hardcoded data. All project configuration is passed in
via the `project` dict argument (loaded from ripple.config.json by the
caller — see scripts/analyze.py).

Public API:
    parse_sessions(project, **kwargs) -> dict
        Classifies all session files for a project, computes stats,
        and returns a structured analytics dict.

Session classification:
    bot       < 2s duration
    ghost     > 5min, no registered interaction
    bounce    < 10s, no interaction
    glancer   10-60s, no interaction (still a real person)
    engaged   any duration, has interaction events
    deep      60s+, has interaction events

"Real users" = glancer + engaged + deep
"""

import json
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from urllib.parse import urlparse
import subprocess

# ── Defaults (overridable via config) ─────────────────────────────────────────
DEFAULT_BOT_MAX_S    = 2.0    # sessions shorter than this = bot
DEFAULT_GHOST_MIN_S  = 300.0  # sessions longer than this with no interaction = ghost tab
DEFAULT_DEEP_MIN_S   = 60.0   # sessions longer than this with interaction = deep
DEFAULT_MAX_STORED   = 300    # max individual session records in output
DEFAULT_VIEW_DUR_CAP = 300.0  # cap per-view duration at 5 min to filter idle inflation


# ── Classification ────────────────────────────────────────────────────────────

def classify_session(
    sess: dict,
    interaction_events: list,
    bot_max_s: float   = DEFAULT_BOT_MAX_S,
    ghost_min_s: float = DEFAULT_GHOST_MIN_S,
    deep_min_s: float  = DEFAULT_DEEP_MIN_S,
) -> str:
    duration = sess.get("totalDurationSeconds", 0)
    event_names = [e["name"] for e in sess.get("events", [])]
    has_interaction = any(e in interaction_events for e in event_names)

    if duration < bot_max_s:
        return "bot"
    if not has_interaction:
        if duration > ghost_min_s:
            return "ghost"
        if duration < 10:
            return "bounce"
        return "glancer"
    if duration >= deep_min_s:
        return "deep"
    return "engaged"


def is_real_user(cls: str) -> bool:
    return cls in ("glancer", "engaged", "deep")


def is_localhost_session(sess: dict) -> bool:
    """Check if the session originated from localhost / local testing."""
    ref = sess.get("referrer", "") or ""
    if any(local in ref for local in ("localhost", "127.0.0.1", "::1")):
        return True
    for e in sess.get("events", []):
        if e.get("name") == "page_loaded" and "details" in e:
            href = e["details"].get("href", "") or ""
            if any(local in href for local in ("localhost", "127.0.0.1", "::1")):
                return True
    geo = sess.get("geo")
    if geo and isinstance(geo, dict):
        if geo.get("country") == "Localhost" or geo.get("regionName") == "Local":
            return True
    return False


def calculate_ttfa(sess: dict, interaction_events: list) -> float | None:
    """
    Calculate the time (in seconds) between session startTime and the first
    registered interaction event. Returns None if no interaction occurred.
    """
    start_str = sess.get("startTime", "")
    if not start_str:
        return None
    try:
        start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
        first_interaction_ts = None
        for e in sess.get("events", []):
            if e.get("name") in interaction_events:
                e_ts_str = e.get("timestamp", "")
                if e_ts_str:
                    e_dt = datetime.fromisoformat(e_ts_str.replace("Z", "+00:00"))
                    e_ts = e_dt.timestamp()
                    if first_interaction_ts is None or e_ts < first_interaction_ts:
                        first_interaction_ts = e_ts
        if first_interaction_ts is not None:
            return max(0.0, first_interaction_ts - start_dt.timestamp())
    except Exception:
        pass
    return None


# ── Path / device / browser helpers ───────────────────────────────────────────

def session_path(sess: dict) -> str:
    """Summarise a session as a navigation path string: 'intro -> game -> shop'"""
    views = sess.get("views", [])
    if not views:
        return "(no views)"
    parts = []
    for v in views:
        name = v.get("view", "?")
        if not parts or parts[-1] != name:   # collapse consecutive repeats
            parts.append(name)
    return " → ".join(parts)


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


def parse_browser(ua: str) -> str:
    ua = ua or ""
    if "Snapchat"  in ua: return "Snapchat"
    if "Instagram" in ua: return "Instagram"
    if "FBAN"      in ua: return "Facebook"
    if "TikTok"    in ua: return "TikTok"
    if "EdgA"      in ua or "Edg/" in ua: return "Edge"
    if "Chrome"    in ua and "Safari" in ua: return "Chrome"
    if "Firefox"   in ua: return "Firefox"
    if "Safari"    in ua: return "Safari"
    return "Other"


def fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}m {s}s"


# ── Git / deployment helpers ───────────────────────────────────────────────────

def get_deployments(git_repo: str, n: int = 20) -> list:
    """
    Read the last N commits from a local git repo.
    Returns list of {hash, date_iso, message, date_display}.
    Returns [] if git_repo is empty, doesn't exist, or git fails.
    """
    if not git_repo or not Path(git_repo).exists():
        return []
    try:
        result = subprocess.run(
            ["git", "-C", git_repo, "log", f"-{n}", "--format=%H\x1f%aI\x1f%s"],
            capture_output=True, text=True, encoding="utf-8", timeout=5
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
    """Compute key metrics for sessions that started in a given time window."""
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

    path_counts = defaultdict(int)
    for s in window:
        path_counts[session_path(s)] += 1
    top_paths = sorted(path_counts.items(), key=lambda x: -x[1])[:5]

    return {
        "count":           len(window),
        "median_duration": round(median_dur, 1),
        "median_display":  fmt_duration(median_dur),
        "top_paths":       [{"path": p, "count": c} for p, c in top_paths],
    }


def build_deployment_impact(project: dict, real_sessions: list) -> list:
    """
    For each recent git commit in the project's repo, compute before/after
    session metrics to show the behavioral impact of each deployment.
    """
    git_repo = project.get("git_repo", "")
    commits  = get_deployments(git_repo)
    if not commits:
        return []

    result = []
    for i, commit in enumerate(commits):
        after_iso = commit["date_iso"]
        after_stats  = sessions_in_window(real_sessions, after_iso, None)
        before_stats = (
            sessions_in_window(real_sessions, commits[i + 1]["date_iso"], after_iso)
            if i < len(commits) - 1
            else {"count": 0}
        )
        result.append({
            **commit,
            "sessions_after":  after_stats,
            "sessions_before": before_stats,
        })
    return result


def build_visitors(session_records: list) -> list:
    """Groups sessions by visitor ID and generates an audience profile narrative."""
    from collections import defaultdict
    visitors_map = defaultdict(list)
    for s in session_records:
        sid = s["id"]
        parts = sid.split('_')
        vid = parts[1] if (len(parts) >= 3 and parts[0] == "sess") else sid
        visitors_map[vid].append(s)
        
    visitors = []
    for vid, sessions in visitors_map.items():
        # Sort chronologically to find first visit
        sessions = sorted(sessions, key=lambda x: x["start"])
        
        count = len(sessions)
        first_visit = sessions[0]["start"]
        last_visit = sessions[-1]["start"]
        
        total_duration = sum(s["duration_s"] for s in sessions)
        avg_duration = total_duration / count
        
        # Deduplicate browsers, devices, locations
        browsers = list(set(s["browser"] for s in sessions))
        devices = list(set(s["device"] for s in sessions))
        locations = list(set(f"{s['city']}, {s['country']}" for s in sessions if s.get("country") and s["country"] != "Unknown"))
        if not locations:
            locations = ["Unknown Location"]
            
        # Determine classification (highest intent wins)
        classes = [s["classification"] for s in sessions]
        if "deep" in classes: user_type = "deep"
        elif "engaged" in classes: user_type = "engaged"
        elif "glancer" in classes: user_type = "glancer"
        elif "ghost" in classes: user_type = "ghost"
        elif "bounce" in classes: user_type = "bounce"
        else: user_type = "bot"
        
        # Narrative
        try:
            dt = datetime.fromisoformat(first_visit.replace("Z", "+00:00"))
            date_str = dt.strftime("%b %d")
            time_str = dt.strftime("%I:%M %p")
        except Exception:
            date_str = "an unknown date"
            time_str = "an unknown time"
            
        loc_str = locations[0]
        b_str = browsers[0]
        d_str = devices[0]
        
        narrative = (
            f"This user first visited on {date_str} at {time_str} from {loc_str}. "
            f"They have visited {count} time(s) using {b_str} on a {d_str} device. "
            f"With an average session duration of {fmt_duration(avg_duration)}, they are classified as a '{user_type.capitalize()}' user."
        )
        
        visitors.append({
            "visitor_id": vid,
            "session_count": count,
            "first_visit": first_visit,
            "last_visit": last_visit,
            "total_duration_s": total_duration,
            "avg_duration_s": avg_duration,
            "avg_duration": fmt_duration(avg_duration),
            "user_type": user_type,
            "locations": locations,
            "browsers": browsers,
            "devices": devices,
            "narrative": narrative,
            "sessions": sorted(sessions, key=lambda x: x["start"], reverse=True)
        })
        
    return sorted(visitors, key=lambda x: x["last_visit"], reverse=True)


# ── Main parse ────────────────────────────────────────────────────────────────

def parse_sessions(
    project: dict,
    min_duration_bot: float  = DEFAULT_BOT_MAX_S,
    max_duration_ghost: float = DEFAULT_GHOST_MIN_S,
    max_sessions_stored: int  = DEFAULT_MAX_STORED,
) -> dict:
    """
    Parse all session files for a project and return a structured analytics dict.

    project dict keys (all from ripple.config.json):
        key               str   unique project slug
        name              str   display name
        url               str   public URL (optional)
        sessions_dir      str   absolute path to folder containing sess_*.json files
        git_repo          str   absolute path to git repo root (optional)
        interaction_events list  event names that count as real user interaction
        goals             list  plain-text goal strings (passed through for intelligence layer)
    """
    sessions_dir       = Path(project["sessions_dir"])
    interaction_events = project.get("interaction_events", [])

    if not sessions_dir.exists():
        return {"project_key": project["key"], "error": f"Sessions dir not found: {sessions_dir}"}

    # ── Load ──────────────────────────────────────────────────────────────────
    raw_sessions = []
    for f in sorted(sessions_dir.glob("sess_*.json")):
        try:
            with open(f, encoding="utf-8") as fh:
                raw_sessions.append(json.load(fh))
        except Exception:
            pass

    if not raw_sessions:
        return {"project_key": project["key"], "error": "No session files found"}

    # ── Classify ──────────────────────────────────────────────────────────────
    classified = [
        (classify_session(s, interaction_events, min_duration_bot, max_duration_ghost), s)
        for s in raw_sessions
    ]
    total_raw = len(classified)
    counts    = defaultdict(int)
    localhost_count = 0
    for c, s in classified:
        if is_localhost_session(s):
            localhost_count += 1
        else:
            counts[c] += 1

    real_sessions    = [s for c, s in classified if is_real_user(c) and not is_localhost_session(s)]
    human_sessions   = [s for c, s in classified if c != "bot" and not is_localhost_session(s)]
    engaged_sessions = [s for c, s in classified if c in ("engaged", "deep") and not is_localhost_session(s)]
    real_count       = len(real_sessions)
    engagement_rate  = (len(engaged_sessions) / len(human_sessions) * 100) if human_sessions else 0

    # ── Duration ──────────────────────────────────────────────────────────────
    durations = sorted(s.get("totalDurationSeconds", 0) for s in real_sessions)
    if durations:
        mean_dur   = sum(durations) / len(durations)
        median_dur = durations[len(durations) // 2]
        p75_dur    = durations[int(len(durations) * 0.75)]
    else:
        mean_dur = median_dur = p75_dur = 0

    # ── Referrers & Geography ─────────────────────────────────────────────────
    ref_counts = defaultdict(int)
    country_counts = defaultdict(int)
    for s in real_sessions:
        ref_counts[referrer_label(s.get("referrer", "") or "direct")] += 1
        if "geo" in s and isinstance(s["geo"], dict):
            country_counts[s["geo"].get("country", "Unknown")] += 1
            
    top_referrers = [{"source": r, "count": c}
                     for r, c in sorted(ref_counts.items(), key=lambda x: -x[1])[:10]]
    top_countries = [{"country": c, "count": n}
                     for c, n in sorted(country_counts.items(), key=lambda x: -x[1])[:10]]

    # 📱 Device 📱
    mobile_count  = sum(1 for s in real_sessions if device_type(s.get("userAgent", "")) == "mobile")
    desktop_count = real_count - mobile_count

    # ── Time-to-First-Action (TTFA) ──────────────────────────────────────────
    ttfas = [calculate_ttfa(s, interaction_events) for s in real_sessions]
    ttfas = sorted(t for t in ttfas if t is not None)
    median_ttfa = ttfas[len(ttfas) // 2] if ttfas else None

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
    daily_bounces = defaultdict(int)
    daily_engaged = defaultdict(int)
    daily_glancers = defaultdict(int)
    
    for c, s in classified:
        if c == "bot" or is_localhost_session(s): continue
        try:
            dt = datetime.fromisoformat(s["startTime"].replace("Z", "+00:00"))
            d_str = dt.strftime("%Y-%m-%d")
            if c != "bounce": # Keep daily_trend matching real_sessions + ghost (wait, is_real_user is glancer, engaged, deep)
                if is_real_user(c):
                    daily[d_str] += 1
            if c == "bounce": daily_bounces[d_str] += 1
            elif c in ("engaged", "deep"): daily_engaged[d_str] += 1
            elif c == "glancer": daily_glancers[d_str] += 1
        except Exception:
            pass
            
    daily_trend = dict(sorted(daily.items())[-1000:])
    daily_bounces_dict = dict(sorted(daily_bounces.items())[-1000:])
    daily_engaged_dict = dict(sorted(daily_engaged.items())[-1000:])
    daily_glancers_dict = dict(sorted(daily_glancers.items())[-1000:])

    # ── Event frequency ───────────────────────────────────────────────────────
    event_counts = defaultdict(int)
    for s in real_sessions:
        for e in s.get("events", []):
            event_counts[e["name"]] += 1
    top_events = [{"event": e, "count": c}
                  for e, c in sorted(event_counts.items(), key=lambda x: -x[1])[:15]]

    # ── Navigation paths ──────────────────────────────────────────────────────
    path_sessions  = defaultdict(list)
    path_durations = defaultdict(list)
    for s in real_sessions:
        p   = session_path(s)
        sid = s.get("sessionId", "?")
        path_sessions[p].append(sid)
        path_durations[p].append(s.get("totalDurationSeconds", 0))

    navigation_paths = []
    for path_str, sids in sorted(path_sessions.items(), key=lambda x: -len(x[1])):
        durs    = path_durations[path_str]
        avg_dur = sum(durs) / len(durs) if durs else 0
        navigation_paths.append({
            "path":         path_str,
            "count":        len(sids),
            "pct":          round(len(sids) / real_count * 100, 1) if real_count else 0,
            "avg_duration": round(avg_dur, 1),
            "avg_display":  fmt_duration(avg_dur),
            "session_ids":  sids,
        })

    # ── View funnel ───────────────────────────────────────────────────────────
    first_view_counts = defaultdict(int)
    view_visit_counts = defaultdict(int)
    view_durations    = defaultdict(list)
    view_exit_counts  = defaultdict(int)

    for s in real_sessions:
        views = s.get("views", [])
        if not views:
            continue
        first_view_counts[views[0].get("view", "?")] += 1
        seen = set()
        for i, v in enumerate(views):
            vname = v.get("view", "?")
            if vname not in seen:
                view_visit_counts[vname] += 1
                seen.add(vname)
            view_durations[vname].append(v.get("durationSeconds", 0))
        view_exit_counts[views[-1].get("view", "?")] += 1

    view_funnel = []
    for vname in sorted(view_visit_counts, key=lambda v: -view_visit_counts[v]):
        durs   = view_durations[vname]
        # Cap each individual view duration to filter idle/abandoned tabs
        capped = [min(d, DEFAULT_VIEW_DUR_CAP) for d in durs]
        avg_d  = sum(capped) / len(capped) if capped else 0
        visits = view_visit_counts[vname]
        exits  = view_exit_counts.get(vname, 0)
        entries = first_view_counts.get(vname, 0)
        view_funnel.append({
            "view":         vname,
            "visits":       visits,
            "visit_pct":    round(visits / real_count * 100, 1) if real_count else 0,
            "avg_duration": round(avg_d, 1),
            "avg_display":  fmt_duration(avg_d),
            "exit_count":   exits,
            "exit_pct":     round(exits / visits * 100, 1) if visits else 0,
            "entry_count":  entries,
            "entry_pct":    round(entries / real_count * 100, 1) if real_count else 0,
        })

    # ── Individual session records ────────────────────────────────────────────
    cls_map = {s.get("sessionId"): c for c, s in classified}
    session_records = []
    for s in sorted(raw_sessions, key=lambda x: x.get("startTime", ""), reverse=True)[:max_sessions_stored]:
        sid = s.get("sessionId", "?")
        ua  = s.get("userAgent", "")
        geo = s.get("geo", {})
        country = geo.get("country", "Unknown") if isinstance(geo, dict) else "Unknown"
        city = geo.get("city", "Unknown") if isinstance(geo, dict) else "Unknown"
        
        ttfa = calculate_ttfa(s, interaction_events)
        session_records.append({
            "id":             sid,
            "start":          s.get("startTime", ""),
            "duration_s":     round(s.get("totalDurationSeconds", 0), 1),
            "duration":       fmt_duration(s.get("totalDurationSeconds", 0)),
            "classification": cls_map.get(sid, "?"),
            "is_localhost":   is_localhost_session(s),
            "ttfa_s":         round(ttfa, 1) if ttfa is not None else None,
            "referrer":       referrer_label(s.get("referrer", "") or "direct"),
            "device":         device_type(ua),
            "browser":        parse_browser(ua),
            "path":           session_path(s),
            "country":        country,
            "city":           city,
            "views": [
                {
                    "view":       v.get("view", "?"),
                    "duration_s": round(v.get("durationSeconds", 0), 1),
                    "duration":   fmt_duration(v.get("durationSeconds", 0)),
                }
                for v in s.get("views", [])
            ],
            "events": [
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
        "project":                  project["name"],
        "project_key":              project["key"],
        "url":                      project.get("url", ""),
        "goals":                    project.get("goals", []),
        "generated_at":             datetime.now(timezone.utc).isoformat(),
        "total_raw":                total_raw,
        "real_user_count":          real_count,
        "localhost_count":          localhost_count,
        "median_ttfa_seconds":      round(median_ttfa, 1) if median_ttfa is not None else None,
        "classification_breakdown": dict(counts),
        "bot_rate_pct":             round(counts["bot"] / total_raw * 100, 1) if total_raw else 0,
        "ghost_rate_pct":           round(counts["ghost"] / total_raw * 100, 1) if total_raw else 0,
        "engagement_rate_pct":      round(engagement_rate, 1),
        "duration": {
            "mean_seconds":   round(mean_dur, 1),
            "median_seconds": round(median_dur, 1),
            "p75_seconds":    round(p75_dur, 1),
            "mean_display":   fmt_duration(mean_dur),
            "median_display": fmt_duration(median_dur),
            "p75_display":    fmt_duration(p75_dur),
        },
        "device":           {"mobile": mobile_count, "desktop": desktop_count},
        "top_referrers":    top_referrers,
        "top_countries":    top_countries,
        "top_events":       top_events,
        "hourly_chart":     hourly_chart,
        "daily_trend":      daily_trend,
        "daily_bounces":    daily_bounces_dict,
        "daily_engaged":    daily_engaged_dict,
        "daily_glancers":   daily_glancers_dict,
        "navigation_paths": navigation_paths,
        "view_funnel":      view_funnel,
        "visitors":         build_visitors(session_records),
        "sessions":         session_records,
        "deployments":      build_deployment_impact(project, real_sessions),
    }
