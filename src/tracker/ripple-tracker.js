/**
 * Ripple Tracker  v0.1.0
 * ========================
 * Drop-in session tracker for any project monitored by Ripple.
 * Matches the sess_*.json schema consumed by session_analytics.py.
 *
 * Install:
 *   <script src="/path/to/ripple-tracker.js"
 *           data-ripple-key="my-project"
 *           data-ripple-endpoint="/api/session.php"></script>
 *
 * Debug Mode (shows live event log overlay):
 *   URL:           ?ripple_debug=1
 *   localStorage:  localStorage.setItem('ripple_debug', 'true')
 *   Console:       Ripple.debug.enable()
 *
 * Manual API:
 *   Ripple.track('event_name', { optional: 'details' })
 *   Ripple.setView('view-name')
 *   Ripple.debug.toggle()
 *   Ripple.flush()
 */
(function (global) {
    'use strict';

    // ── Config from <script> tag ──────────────────────────────────────────────
    const _script     = document.currentScript;
    const PROJECT_KEY = (_script && _script.getAttribute('data-ripple-key'))      || 'unknown';
    const ENDPOINT    = (_script && _script.getAttribute('data-ripple-endpoint')) || '/api/session.php';
    const DEBUG_MODE  = new URLSearchParams(location.search).has('ripple_debug') ||
                        localStorage.getItem('ripple_debug') === 'true';

    // ── Session state ─────────────────────────────────────────────────────────
    const _startMs   = Date.now();
    const _startTime = new Date().toISOString();

    // Persistent visitor ID — stored in localStorage so multiple sessions
    // from the same browser share the same prefix. This lets session_analytics.py
    // group them into inferred journeys ("Unique Visitors" tab).
    const _VISITOR_KEY = '_ripple_vid';
    const _visitorId   = (function () {
        try {
            let vid = localStorage.getItem(_VISITOR_KEY);
            if (!vid) {
                vid = Math.random().toString(36).slice(2, 13);
                localStorage.setItem(_VISITOR_KEY, vid);
            }
            return vid;
        } catch (_) {
            // localStorage blocked (private mode, iframe, etc.) — fall back to random
            return Math.random().toString(36).slice(2, 13);
        }
    }());

    // Session ID embeds the visitor ID as prefix: sess_{visitorId}_{timestamp}
    // Matches the example.com schema so session_analytics.py can link sessions.
    const _sessionId = `sess_${_visitorId}_${_startMs}`;

    let _currentView  = null;
    let _viewStartMs  = _startMs;
    const _views      = [];   // { view, entered, left, durationSeconds }
    const _events     = [];   // { name, timestamp, details }
    const _pendingLog = [];   // buffered debug messages before overlay is ready
    let _overlayReady = false;
    let _flushed      = false;

    // (Session ID is now built directly from _visitorId + timestamp above.)
    // _genId() removed — no longer needed.

    // ── Public API ────────────────────────────────────────────────────────────
    const Ripple = {
        /**
         * Record a named event with optional details dict.
         * @param {string} name
         * @param {object} [details]
         */
        track(name, details) {
            const entry = { name, timestamp: new Date().toISOString() };
            if (details && Object.keys(details).length > 0) entry.details = details;
            _events.push(entry);
            _debugLog(name, details || {}, 'event');
            _updateCount();
        },

        /**
         * Signal a view change. Call this when the user navigates to a new
         * logical section, tab, or page within a single-page app.
         * @param {string} viewName
         */
        setView(viewName) {
            if (viewName === _currentView) return;
            const now = Date.now();
            if (_currentView !== null) {
                const dur = (now - _viewStartMs) / 1000;
                _views.push({
                    view:            _currentView,
                    entered:         new Date(_viewStartMs).toISOString(),
                    left:            new Date(now).toISOString(),
                    durationSeconds: dur,
                });
                _debugLog('view_left', { view: _currentView, duration: `${dur.toFixed(1)}s` }, 'view');
            }
            _currentView = viewName;
            _viewStartMs = now;
            _debugLog('view_entered', { view: viewName }, 'view');
        },

        /** Force a flush of the current session to the endpoint. */
        flush() { _flush(false); },

        debug: {
            enable()  { localStorage.setItem('ripple_debug', 'true');  location.reload(); },
            disable() { localStorage.removeItem('ripple_debug');        location.reload(); },
            toggle()  { DEBUG_MODE ? Ripple.debug.disable() : Ripple.debug.enable(); },
        },
    };

    // ── Auto-tracking: page load ──────────────────────────────────────────────
    Ripple.track('page_loaded', { href: location.href });

    // ── Auto-tracking: [data-ripple-event] clicks ─────────────────────────────
    document.addEventListener('click', function (e) {
        const el = e.target.closest('[data-ripple-event]');
        if (!el) return;
        const name    = el.getAttribute('data-ripple-event');
        const label   = el.getAttribute('data-ripple-label') || el.textContent.trim().slice(0, 80);
        Ripple.track(name, { label, element: el.tagName.toLowerCase() });
    }, true);

    // ── Auto-tracking: [data-ripple-view] visibility ──────────────────────────
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting && e.intersectionRatio >= 0.6) {
                    const v = e.target.getAttribute('data-ripple-view');
                    if (v) Ripple.setView(v);
                }
            });
        }, { threshold: 0.6 });
        // Observe after DOM is ready
        const _observeViews = () => document.querySelectorAll('[data-ripple-view]').forEach(el => io.observe(el));
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _observeViews);
        } else {
            _observeViews();
        }
    }

    // ── Flush logic ───────────────────────────────────────────────────────────
    function _buildPayload() {
        const nowMs     = Date.now();
        const snapViews = [..._views];
        if (_currentView !== null) {
            snapViews.push({
                view:            _currentView,
                entered:         new Date(_viewStartMs).toISOString(),
                left:            new Date(nowMs).toISOString(),
                durationSeconds: (nowMs - _viewStartMs) / 1000,
            });
        }
        return {
            sessionId:            _sessionId,
            projectKey:           PROJECT_KEY,
            referrer:             document.referrer || 'direct',
            userAgent:            navigator.userAgent,
            startTime:            _startTime,
            views:                snapViews,
            events:               _events,
            totalDurationSeconds: (nowMs - _startMs) / 1000,
        };
    }

    function _flush(sync) {
        const payload = _buildPayload();
        const body    = JSON.stringify(payload);
        if (sync && navigator.sendBeacon) {
            navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
            _flushed = true;
        } else {
            fetch(ENDPOINT, {
                method:    'POST',
                headers:   { 'Content-Type': 'application/json' },
                body,
                keepalive: true,
            }).catch(() => {}); // silent — offline/localhost failures are fine
        }
    }

    // Periodic flush every 30 s
    setInterval(() => _flush(false), 30000);

    // Sync flush on unload
    window.addEventListener('pagehide',      () => _flush(true));
    window.addEventListener('beforeunload',  () => _flush(true));

    // ── Debug overlay ─────────────────────────────────────────────────────────
    const LOG_COLORS = { event: '#3fb950', view: '#d29922', sys: '#388bfd' };

    function _debugLog(name, details, type) {
        const entry = { name, details, type, time: new Date().toTimeString().slice(0, 8) };
        if (!_overlayReady) { _pendingLog.push(entry); return; }
        _renderLogEntry(entry);
    }

    function _renderLogEntry({ name, details, type, time }) {
        const logEl = document.getElementById('_rpl_log');
        if (!logEl) return;

        const color = LOG_COLORS[type] || LOG_COLORS.sys;

        // Human-readable detail string
        const detailStr = details && Object.keys(details).length
            ? Object.entries(details)
                .map(([k, v]) => `<span style="color:#8b949e">${k}:</span>\u00a0<span style="color:#e6edf3">${String(v).slice(0, 80)}</span>`)
                .join('&ensp;')
            : '';

        const row = document.createElement('div');
        row.style.cssText = 'padding:4px 0; border-bottom:1px solid rgba(34,42,61,0.4); font-size:0.73rem; line-height:1.5; word-break:break-all;';
        row.innerHTML =
            `<span style="color:#555e6d">${time}</span>` +
            `&ensp;<span style="color:${color};font-weight:700">${name}</span>` +
            (detailStr ? `&ensp;${detailStr}` : '');
        logEl.prepend(row);

        // Cap at 60 entries
        while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);

        // Pulse dot
        const dot = document.getElementById('_rpl_dot');
        if (dot) {
            dot.style.background = color;
            setTimeout(() => { dot.style.background = '#3fb950'; }, 450);
        }
    }

    function _updateCount() {
        const el = document.getElementById('_rpl_count');
        if (el) el.textContent = `${_events.length} event${_events.length !== 1 ? 's' : ''}`;
    }

    function _buildDebugOverlay() {
        // Inject keyframe animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes _rpl_pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
            #_rpl_dot { animation: _rpl_pulse 2s ease-in-out infinite; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = '_rpl_panel';
        panel.style.cssText = [
            'position:fixed', 'bottom:20px', 'right:20px', 'width:370px',
            'background:#090b0f', 'border:1px solid #222a3d', 'border-radius:10px',
            "font-family:'Fira Code',monospace", 'z-index:2147483647',
            'box-shadow:0 8px 32px rgba(0,0,0,.7)', 'overflow:hidden',
            'transition:max-height .2s ease', 'max-height:440px',
        ].join(';');

        panel.innerHTML = `
<div id="_rpl_header" style="padding:8px 12px;background:#121620;border-bottom:1px solid #222a3d;
     display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">
  <div style="display:flex;align-items:center;gap:8px;">
    <div id="_rpl_dot" style="width:8px;height:8px;border-radius:50%;background:#3fb950;flex-shrink:0;"></div>
    <span style="color:#f0f3f6;font-weight:700;font-size:0.78rem;">Ripple Debug</span>
    <span style="color:#388bfd;font-size:0.7rem;">${PROJECT_KEY}</span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <span id="_rpl_count" style="color:#8b949e;font-size:0.7rem;">0 events</span>
    <button id="_rpl_toggle" style="background:transparent;border:1px solid #2e3b56;color:#8b949e;
            padding:1px 7px;border-radius:4px;cursor:pointer;font-size:0.7rem;font-family:inherit;">−</button>
  </div>
</div>
<div id="_rpl_body" style="padding:8px 12px;overflow-y:auto;max-height:390px;">
  <div style="color:#555e6d;font-size:0.68rem;padding:4px 0 8px;border-bottom:1px solid rgba(34,42,61,.5);margin-bottom:6px;">
    <span style="color:#388bfd">${_sessionId.slice(0, 26)}</span>
    &ensp;started <span style="color:#d29922">${_startTime.slice(11, 19)}</span> UTC
  </div>
  <div id="_rpl_log" style="display:flex;flex-direction:column;"></div>
</div>`;

        document.body.appendChild(panel);
        _overlayReady = true;

        // Toggle collapse/expand
        let _collapsed = false;
        document.getElementById('_rpl_toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            _collapsed = !_collapsed;
            document.getElementById('_rpl_body').style.display = _collapsed ? 'none' : 'block';
            document.getElementById('_rpl_toggle').textContent = _collapsed ? '+' : '−';
            panel.style.maxHeight = _collapsed ? '37px' : '440px';
        });

        // Flush pending logs
        _pendingLog.forEach(_renderLogEntry);
        _pendingLog.length = 0;

        _debugLog('tracker_ready', { project: PROJECT_KEY, endpoint: ENDPOINT }, 'sys');
        _updateCount();
    }

    if (DEBUG_MODE) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _buildDebugOverlay);
        } else {
            _buildDebugOverlay();
        }
    }

    // ── Expose ────────────────────────────────────────────────────────────────
    global.Ripple = Ripple;

})(window);
