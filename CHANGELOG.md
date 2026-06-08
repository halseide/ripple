# Ripple Changelog

All notable changes to the Ripple tracker and dashboard. Newest first.

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
