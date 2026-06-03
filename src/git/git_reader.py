#!/usr/bin/env python3
"""
Ripple — Git Reader
====================
Reads a local git repository's commit history and returns structured
deployment events. These events are the backbone of Ripple's before/after
behavioral diff: every commit is a potential deployment, and we compute
what changed in user behavior before vs. after each one.

This module is purely a git log reader. It does NOT classify commits,
filter by message, or make any decisions about which commits "matter."
That is the intelligence layer's job.

Public API:
    get_commits(repo_path, n, since_days) -> list[CommitEvent]
    get_commits_between(repo_path, before_iso, after_iso) -> list[CommitEvent]
    tag_sessions_with_deployment(sessions, commits) -> list[dict]

CommitEvent shape:
    {
        "hash":          str   # short 8-char hash
        "hash_full":     str   # full 40-char hash
        "date_iso":      str   # UTC ISO 8601
        "date_ts":       float # UTC unix timestamp (for fast comparisons)
        "date_display":  str   # "Jun 03, 14:22"
        "author":        str   # author name
        "message":       str   # full commit subject line
        "message_short": str   # first 72 chars
        "files_changed": int   # number of files changed (if available)
        "insertions":    int   # lines added (if available)
        "deletions":     int   # lines removed (if available)
    }
"""

import subprocess
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional


# ── Core reader ───────────────────────────────────────────────────────────────

def get_commits(
    repo_path: str,
    n: int = 50,
    since_days: Optional[int] = None,
) -> list:
    """
    Return up to `n` recent commits from the given git repo.
    If `since_days` is set, only return commits from the last N days.

    Returns a list of CommitEvent dicts, newest-first.
    Returns [] if repo_path is empty, doesn't exist, or git fails.
    """
    if not repo_path or not Path(repo_path).exists():
        return []

    cmd = [
        "git", "-C", repo_path, "log",
        f"-{n}",
        "--format=%H\x1f%aI\x1f%an\x1f%s",
        "--shortstat",        # adds "N files changed, X insertions, Y deletions" after each
    ]

    if since_days is not None:
        since_date = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%d")
        cmd.append(f"--since={since_date}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=repo_path,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    if result.returncode != 0:
        return []

    return _parse_log_output(result.stdout)


def get_commits_between(
    repo_path: str,
    after_iso: str,
    before_iso: Optional[str] = None,
) -> list:
    """
    Return commits between two ISO timestamps (after_iso <= commit < before_iso).
    If before_iso is None, returns all commits after after_iso up to HEAD.
    """
    if not repo_path or not Path(repo_path).exists():
        return []

    cmd = [
        "git", "-C", repo_path, "log",
        "--format=%H\x1f%aI\x1f%an\x1f%s",
        "--shortstat",
        f"--after={after_iso}",
    ]
    if before_iso:
        cmd.append(f"--before={before_iso}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=repo_path,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    return _parse_log_output(result.stdout)


def tag_sessions_with_deployment(sessions: list, commits: list) -> list:
    """
    For each session, find which deployment window it falls into —
    i.e. which commit was most recently deployed before the session started.

    Adds a "deployment_hash" key to each session dict (or None if before
    the first tracked commit).

    Returns the session list with the new key added (non-destructive copy).
    """
    if not commits or not sessions:
        return sessions

    # Build sorted list of (timestamp, hash) newest-first is already the default,
    # but we need oldest-first for window matching.
    sorted_commits = sorted(commits, key=lambda c: c["date_ts"])

    tagged = []
    for session in sessions:
        start_str = session.get("start", "") or session.get("startTime", "")
        session_ts = _parse_ts(start_str)

        deployment_hash = None
        for commit in sorted_commits:
            if commit["date_ts"] <= session_ts:
                deployment_hash = commit["hash"]
            else:
                break  # commits are sorted oldest-first; once we pass the session, stop

        tagged.append({**session, "deployment_hash": deployment_hash})

    return tagged


# ── Diff builder ──────────────────────────────────────────────────────────────

def build_deployment_windows(commits: list, sessions: list) -> list:
    """
    The core Ripple primitive: for each commit, compute:
        - sessions_before: sessions that occurred BEFORE this commit
          (after the previous commit, or the beginning of time)
        - sessions_after:  sessions that occurred AFTER this commit
          (up to the next commit, or now)

    Returns a list of DeploymentWindow dicts, newest-first:
    {
        "commit":          CommitEvent
        "sessions_before": [session_stats_dict]
        "sessions_after":  [session_stats_dict]
        "before_count":    int
        "after_count":     int
    }
    """
    if not commits:
        return []

    # Ensure newest-first ordering (standard Ripple convention)
    sorted_commits = sorted(commits, key=lambda c: c["date_ts"], reverse=True)

    windows = []
    for i, commit in enumerate(sorted_commits):
        commit_ts = commit["date_ts"]

        # "after" = sessions that started after this commit
        # bounded by the next (older) commit if it exists
        older_commit_ts = sorted_commits[i + 1]["date_ts"] if i + 1 < len(sorted_commits) else None

        # "before" = sessions that started before this commit
        # bounded by the next (newer) commit if it exists
        newer_commit_ts = sorted_commits[i - 1]["date_ts"] if i > 0 else None

        after_sessions  = _sessions_in_window(sessions, after_ts=commit_ts,   before_ts=newer_commit_ts)
        before_sessions = _sessions_in_window(sessions, after_ts=older_commit_ts, before_ts=commit_ts)

        windows.append({
            "commit":          commit,
            "sessions_after":  after_sessions,
            "sessions_before": before_sessions,
            "after_count":     len(after_sessions),
            "before_count":    len(before_sessions),
        })

    return windows


# ── Internal helpers ───────────────────────────────────────────────────────────

def _parse_log_output(raw: str) -> list:
    """
    Parse the raw output of `git log --format=%H\x1f%aI\x1f%an\x1f%s --shortstat`.

    git log --shortstat emits blocks like:
        <hash>\x1f<date>\x1f<author>\x1f<subject>
        (blank line)
         3 files changed, 42 insertions(+), 7 deletions(-)
        (blank line)

    Or just two lines if shortstat is empty (e.g. merge commits).
    """
    commits = []
    lines = raw.strip().splitlines()

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        parts = line.split("\x1f", 3)
        if len(parts) < 4:
            i += 1
            continue

        h, date_iso, author, subject = parts
        h = h.strip()
        if len(h) < 10:          # not a hash line — skip
            i += 1
            continue

        try:
            dt = datetime.fromisoformat(date_iso.strip())
            dt_utc = dt.astimezone(timezone.utc)
        except ValueError:
            i += 1
            continue

        # Look ahead for the shortstat line
        files_changed = insertions = deletions = 0
        j = i + 1
        while j < len(lines) and j < i + 3:
            stat_line = lines[j].strip()
            if "files changed" in stat_line or "file changed" in stat_line:
                files_changed, insertions, deletions = _parse_shortstat(stat_line)
                break
            j += 1

        commits.append({
            "hash":          h[:8],
            "hash_full":     h,
            "date_iso":      dt_utc.isoformat(),
            "date_ts":       dt_utc.timestamp(),
            "date_display":  dt_utc.strftime("%b %d, %H:%M"),
            "author":        author.strip(),
            "message":       subject.strip(),
            "message_short": subject.strip()[:72],
            "files_changed": files_changed,
            "insertions":    insertions,
            "deletions":     deletions,
        })

        i += 1

    return commits


def _parse_shortstat(line: str) -> tuple:
    """
    Parse a git shortstat line like:
      ' 3 files changed, 42 insertions(+), 7 deletions(-)'
    Returns (files_changed, insertions, deletions).
    """
    import re
    files = insertions = deletions = 0
    m = re.search(r"(\d+) files? changed", line)
    if m:
        files = int(m.group(1))
    m = re.search(r"(\d+) insertion", line)
    if m:
        insertions = int(m.group(1))
    m = re.search(r"(\d+) deletion", line)
    if m:
        deletions = int(m.group(1))
    return files, insertions, deletions


def _parse_ts(s: str) -> float:
    """Parse an ISO timestamp string to UTC unix timestamp. Returns 0.0 on failure."""
    if not s:
        return 0.0
    try:
        return datetime.fromisoformat(
            s.replace("Z", "+00:00")
        ).astimezone(timezone.utc).timestamp()
    except Exception:
        return 0.0


def _sessions_in_window(
    sessions: list,
    after_ts: Optional[float],
    before_ts: Optional[float],
) -> list:
    """
    Filter sessions to those that started in (after_ts, before_ts).
    None means "no bound on that side."
    """
    result = []
    for s in sessions:
        ts = _parse_ts(s.get("start", "") or s.get("startTime", ""))
        if ts == 0.0:
            continue
        if after_ts is not None and ts < after_ts:
            continue
        if before_ts is not None and ts >= before_ts:
            continue
        result.append(s)
    return result


# ── CLI smoke test ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import json

    repo = sys.argv[1] if len(sys.argv) > 1 else "."
    print(f"Reading git log from: {repo}\n")

    commits = get_commits(repo, n=10)
    if not commits:
        print("No commits found or git error.")
        sys.exit(1)

    print(f"Found {len(commits)} commits:\n")
    for c in commits:
        stat = f"{c['files_changed']} files, +{c['insertions']}/-{c['deletions']}"
        print(f"  {c['hash']}  {c['date_display']}  [{stat}]  {c['message_short']}")

    print(f"\nFull first commit:\n{json.dumps(commits[0], indent=2)}")
