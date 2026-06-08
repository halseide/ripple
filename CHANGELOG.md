# Ripple Changelog

All notable changes to the Ripple tracker and dashboard. Newest first.

---

## [v0.9.0] 2026-06-08 🔮 Global Filters & Persistent Tracker Blobs

### Changes
- `7fb56e7` 🧑‍💻 [Vibe] feature: Global filters, live polling, and persistent tracker blobs
- `4c0bf3e` 🧑‍💻 [Vibe] fix: Convert workspace to tabbed interface - Resolves Prompt: prompt_1780943202_ripple
- `39da78f` 🧑‍💻 [Vibe] design: Add Quick Navigation sidebar card and smooth anchor scrolling - Resolves Prompt: prompt_1780939447_ripple
- `08c34fa` — chore: automate changelog stub generation during version bump
- `d3f8fd8` — docs: backfill CHANGELOG.md for v0.8.0 and v0.8.1
- `efb5f87` — [Vibe] fix: Ripple v0.8.1 - Fix prompt search, add cache-busters, and sync resubmits to Vault raw inbox
- `7b2044a` — [Vibe] feature: Ripple v0.8.0 - Vault Path decoupling and A/B metrics
- `42a4ef0` — chore: scrub internal alias from documentation
- `6d18b79` — docs: clarify Zero-Config URL routing mechanics
- `cf61e43` — chore: add bump_version script to automate version sync

---

## [v0.8.1] 2026-06-08 — Prompt Search, Cache-Busters & Inbox Sync

### Fixed
- **fix** · `efb5f87` — Prompt ID search filter on dashboard. Added `promptId` to the search haystack.
- **fix** · `efb5f87` — Dashboard data caching. Added cache-busters (`?t=timestamp`) to all `fetch()` calls to ensure fresh JSON loads.
- **fix** · `efb5f87` — Resubmit sync to Vault. Modified `api/update_prompt.php` to dynamically regenerate and drop the `.md` file back into the Vault's `/raw/` inbox when a prompt's status flips back to `pending`.

---

## [v0.8.0] 2026-06-08 — Vault Path Decoupling & A/B Metrics

### Added
- **feature** · `7b2044a` — **A/B Metrics and Journey Analyzer.** Unified the Numen and Ripple dashboards. Added a Traffic & Commit Activity Timeline Chart and a Session Explorer & Journey Analyzer to the primary workspace.
- **feature** · `7b2044a` — **Vault Path Decoupling.** Scrubbed hardcoded local system paths and decoupled the Vault path logic, now cleanly driven by `ripple.config.json`.

---

## [Vibe Session] 2026-06-05 — Breadcrumb Dots + Handshake Deploy

> 2 Ripple prompts shipped. AI executor: Antigravity.

### Added
- **feature** · `95192fb` (partial) — **Live breadcrumb dots.** After a prompt is
  saved, a throbbing 12px purple dot (`#a78bfa`) appears at the exact
  Shift+Right-Click coordinates. Hover shows a tooltip with the first 80 chars
  of the prompt + promptId. Clicking opens the Ripple dashboard.
  - *Prompt:* (backlog feature — no raw prompt file; implemented during session)
  - *Element:* Page-level breadcrumb overlay, all projects
- **feature** — **Handshake CRM dashboard** deployed at
  `http://localhost/project-beta/ripple/`. CRM-specific vitals: Invites Sent,
  Accept Rate, Active Connections, Flow Abandonment. Ripple Log has full
  filter/sort (status + category + search).

### Fixed
- **fix** · `95192fb` — **Breadcrumb scroll anchoring.** Breadcrumb dot was
  using `clientX/clientY` (viewport-relative) + `position:fixed`, causing it
  to stay pinned to the viewport instead of following the page on scroll.
  Corrected to `e.pageX / e.pageY` capture and `position:absolute` on the dot.
  Fallback coordinates updated to include `window.scrollX/Y` offset.
  - *Prompt:* "if you scroll, the little blob should move with the scroll.
    it is relative, not static because it should stay with the element it is on"
  - *Element:* `body (page-level)` · `http://localhost/project-beta/initiate.php`
  - *Resolved:* `prompt_1780696682_project-beta`

---

## [Vibe Session] 2026-06-05 — Answer Loop + Prompt Log Upgrades (v0.7.0)

> Multiple prompts shipped across prior sessions.

### Added
- **feature** · `fd436a3` — Central dashboard Prompt Log: project filter, sort
  by date/status/category, copy/data/dismissed options, search includes answer
  text.
- **feature** · `e5f7a35` — Closed the answer loop: `api/update_prompt.php`
  backend, dashboard thread view with answer display, reply, re-categorize, and
  dismiss actions. Updated `ripple-process-prompt` SKILL archive rules.
- **feature** · `e65c6be` — Settings panel (gear icon) with `api/config.php`
  read/write backend. `github_url` per project. Conditional commit links in
  Prompt Log. (v0.6.0)

### Fixed
- **fix** · `20d6acc` — Home/debug modes now mutually exclusive at API level.
  `enable()` clears the other flag — no more stale coexistence. (v0.7.6)
- **fix** · `4800ad0` — Nav active state based on `_indicatorState()` not raw
  flags — fixes Debug stuck as `<span>` when both home+debug flags set. (v0.7.5)

---
