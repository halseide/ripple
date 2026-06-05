/**
 * Ripple Tracker  v0.7.5
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
 * UI Capture Mode (omnipresent prompt capture):
 *   Shift + Right-Click any element → opens prompt modal
 *   Click floating Ripple indicator → opens modal targeting body
 *
 * Manual API:
 *   Ripple.track('event_name', { optional: 'details' })
 *   Ripple.setView('view-name')
 *   Ripple.debug.toggle()
 *   Ripple.flush()
 *   Ripple.capture(element)   ← open prompt modal targeting any element
 */
(function (global) {
    'use strict';
    
    const RIPPLE_VERSION = 'v0.7.5';

    // ── Config from <script> tag ──────────────────────────────────────────────
    // document.currentScript is null for dynamically injected scripts (e.g.
    // when the host page creates a <script> element via JS and appends it).
    // Fallback: scan document.scripts for the ripple-tracker src to recover
    // data-ripple-* attributes set on the element before appendChild().
    const _script = (function () {
        if (document.currentScript) return document.currentScript;
        const scripts = document.querySelectorAll('script[src*="ripple-tracker"]');
        return scripts[scripts.length - 1] || null;
    }());

    const PROJECT_KEY  = (_script && _script.getAttribute('data-ripple-key'))      || 'unknown';
    const PROJECT_PATH = (_script && _script.getAttribute('data-ripple-path'))     || `/${PROJECT_KEY}`;
    const ENDPOINT     = (_script && _script.getAttribute('data-ripple-endpoint')) || '/api/session.php';
    const CAPTURE_EP   = '/ripple/api/capture_prompt.php';
    const DEBUG_MODE   = new URLSearchParams(location.search).has('ripple_debug') ||
                         localStorage.getItem('ripple_debug') === 'true';
    let   _homeMode    = localStorage.getItem('ripple_home') === 'true';


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
    let _modalOpen    = false;

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

        /**
         * Open the prompt capture modal targeting a specific element.
         * @param {Element} [element] - DOM element to target (defaults to document.body)
         */
        capture(element) { _openModal(element || document.body); },

        debug: {
            enable()  { localStorage.setItem('ripple_debug', 'true');  location.reload(); },
            disable() { localStorage.removeItem('ripple_debug');        location.reload(); },
            toggle()  { DEBUG_MODE ? Ripple.debug.disable() : Ripple.debug.enable(); },
        },

        home: {
            enable()  { localStorage.setItem('ripple_home', 'true');   location.reload(); },
            disable() { localStorage.removeItem('ripple_home');         location.reload(); },
            toggle()  { _homeMode ? Ripple.home.disable() : Ripple.home.enable(); },
        },
    };

    // ── Auto-tracking: page load ──────────────────────────────────────────────
    Ripple.track('page_loaded', { href: location.href });

    // ── Auto-Instrumentation Layer ────────────────────────────────────────────
    // Everything below fires automatically on injection — zero changes needed
    // in the host page. All events flow into Ripple.track() and appear in the
    // debug overlay and session payload.

    /**
     * Build a short, stable "fingerprint" for an element so we can
     * deduplicate rapid duplicate events and detect rage-clicks.
     * Format: "tag#id.class1.class2"
     */
    function _elKey(el) {
        if (!el || el === document.body || el === document.documentElement) return 'body';
        let k = (el.tagName || 'div').toLowerCase();
        if (el.id)        k += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
            k += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        }
        return k;
    }

    /**
     * Build a readable label for any element: tries text, aria-label,
     * title, placeholder, value, id in that order.
     */
    function _elLabel(el) {
        if (!el) return '';
        let lbl =
            el.getAttribute('aria-label') ||
            el.title ||
            el.placeholder ||
            el.textContent?.trim().slice(0, 80) ||
            el.id ||
            el.getAttribute('name') ||
            '';
        return lbl.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 80);
    }

    // ── 1. Universal click capture ────────────────────────────────────────────
    // Captures EVERY click, not just buttons/links. Uses capturing phase so it
    // fires before any handler on the page can stopPropagation.
    const _recentClicks = []; // for rage-click detection

    document.addEventListener('click', function (e) {
        // Skip our own modal/indicator clicks
        const skip = e.target.closest('#_rpl_panel, #_rpl_indicator, #_rpl_capture_modal, #_rpl_backdrop, [id^="_rpl_"]');
        if (skip) return;

        // Skip shift+right-click (that's for the modal)
        if (e.button !== 0) return;

        const el    = e.target;
        const key   = _elKey(el);
        const label = _elLabel(el);
        const tag   = (el.tagName || '').toLowerCase();
        const path  = _getCssPath(el).slice(0, 120);

        // Determine a sensible event name
        let evtName = 'element_clicked';
        if (tag === 'a')       evtName = 'link_clicked';
        else if (tag === 'button')  evtName = 'button_clicked';
        else if (tag === 'select')  evtName = 'select_clicked';
        else if (tag === 'input') {
            const t = (el.type || '').toLowerCase();
            if      (t === 'checkbox') evtName = 'checkbox_toggled';
            else if (t === 'radio')    evtName = 'radio_selected';
            else if (t === 'submit')   evtName = 'form_submitted';
            else if (t === 'range')    evtName = 'slider_moved';
            else                       evtName = 'input_clicked';
        }
        // Check for [data-ripple-event] manual override (highest priority)
        const manualEl = el.closest('[data-ripple-event]');
        if (manualEl) {
            evtName = manualEl.getAttribute('data-ripple-event');
        }

        const details = {
            element: tag,
            label:   label || '(no label)',
            path:    path,
        };
        if (el.href)             details.href    = el.href.slice(0, 100);
        if (el.id)               details.id      = el.id;
        if (el.getAttribute('data-ripple-label')) details.label = el.getAttribute('data-ripple-label');

        Ripple.track(evtName, details);

        // ── Rage-click detection ─────────────────────────────────────────────
        const now = Date.now();
        _recentClicks.push({ key, t: now });
        // Keep only last 600ms window
        while (_recentClicks.length && now - _recentClicks[0].t > 600) _recentClicks.shift();
        const sameTarget = _recentClicks.filter(c => c.key === key);
        if (sameTarget.length >= 3) {
            Ripple.track('rage_click', { element: tag, label, path, count: sameTarget.length });
            _recentClicks.length = 0; // reset after reporting
        }

    }, true); // capture phase

    // ── 2. Input / Select / Textarea changes ──────────────────────────────────
    document.addEventListener('change', function (e) {
        const el  = e.target;
        const tag = (el.tagName || '').toLowerCase();
        if (!['input', 'select', 'textarea'].includes(tag)) return;

        const skip = el.closest('[id^="_rpl_"]');
        if (skip) return;

        const t       = (el.type || '').toLowerCase();
        const label   = _elLabel(el);
        const path    = _getCssPath(el).slice(0, 120);

        // Privacy: never capture actual text values; just metadata
        let valueInfo = {};
        if (t === 'checkbox')       valueInfo = { checked: el.checked };
        else if (t === 'radio')     valueInfo = { value: el.value?.slice(0, 40) };
        else if (t === 'range')     valueInfo = { value: el.value };
        else if (tag === 'select')  valueInfo = { selected: el.value?.slice(0, 40), optionCount: el.options.length };
        else                        valueInfo = { length: el.value?.length || 0 }; // text: just length

        Ripple.track('input_changed', {
            element: tag,
            type:    t || tag,
            label:   label || el.name || el.id || '(unnamed)',
            path,
            ...valueInfo,
        });
    }, true);

    // ── 3. Keyboard: focus engagement on inputs ───────────────────────────────
    let _focusedEl = null;
    document.addEventListener('focusin', function (e) {
        const el  = e.target;
        const tag = (el.tagName || '').toLowerCase();
        if (!['input', 'textarea', 'select'].includes(tag)) return;
        if (el.closest('[id^="_rpl_"]')) return;
        _focusedEl = { el, t: Date.now() };
        Ripple.track('field_focused', {
            element: tag,
            label:   _elLabel(el) || el.name || el.id || '(unnamed)',
            path:    _getCssPath(el).slice(0, 80),
        });
    }, true);

    document.addEventListener('focusout', function (e) {
        if (!_focusedEl) return;
        const secs = ((Date.now() - _focusedEl.t) / 1000).toFixed(1);
        _focusedEl = null;
        if (parseFloat(secs) < 0.3) return; // skip accidental focus flashes
        Ripple.track('field_blurred', { timeInField: secs + 's' });
    }, true);

    // ── 4. Scroll depth milestones ────────────────────────────────────────────
    const _scrollMilestones = new Set();
    function _onScroll() {
        const el     = document.scrollingElement || document.documentElement;
        const pct    = el.scrollHeight <= el.clientHeight
            ? 100
            : Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
        [25, 50, 75, 100].forEach(m => {
            if (pct >= m && !_scrollMilestones.has(m)) {
                _scrollMilestones.add(m);
                Ripple.track('scroll_depth', { percent: m });
            }
        });
    }
    window.addEventListener('scroll', _onScroll, { passive: true });

    // ── 5. Form submissions ───────────────────────────────────────────────────
    document.addEventListener('submit', function (e) {
        const form = e.target;
        Ripple.track('form_submitted', {
            id:     form.id || '(no-id)',
            action: (form.action || '').slice(0, 80),
            method: form.method || 'get',
        });
    }, true);

    // ── 6. Visibility / tab focus (idle + return) ─────────────────────────────
    let _hiddenAt = null;
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            _hiddenAt = Date.now();
            Ripple.track('tab_hidden', {});
        } else {
            const away = _hiddenAt ? ((Date.now() - _hiddenAt) / 1000).toFixed(1) : '?';
            _hiddenAt = null;
            Ripple.track('tab_returned', { awaySeconds: away });
        }
    });

    // ── 7. DOM mutation observer — widget state changes ───────────────────────
    // Watches for attribute changes that indicate state transitions in
    // custom widgets: aria-expanded (accordions, dropdowns), aria-selected
    // (tabs, listboxes), data-active (custom toggle systems), open (details).
    const WATCH_ATTRS = new Set(['aria-expanded', 'aria-selected', 'aria-checked', 'aria-current', 'data-active', 'open', 'data-tab', 'data-state']);

    const _mutObs = new MutationObserver(function (mutations) {
        mutations.forEach(m => {
            if (m.type !== 'attributes') return;
            const attr = m.attributeName;
            if (!WATCH_ATTRS.has(attr)) return;
            const el  = m.target;
            if (el.closest('[id^="_rpl_"]')) return;
            const val = el.getAttribute(attr);
            Ripple.track('widget_state_changed', {
                attribute: attr,
                value:     val,
                element:   (el.tagName || '').toLowerCase(),
                label:     _elLabel(el) || el.id || '(unnamed)',
                path:      _getCssPath(el).slice(0, 80),
            });
        });
    });

    const _startMutObs = () => {
        _mutObs.observe(document.body, {
            attributes:     true,
            attributeFilter: [...WATCH_ATTRS],
            subtree:        true,
        });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _startMutObs);
    } else {
        _startMutObs();
    }

    // ── 8. Auto-detect views from [data-ripple-view] ─────────────────────────
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting && e.intersectionRatio >= 0.6) {
                    const v = e.target.getAttribute('data-ripple-view');
                    if (v) Ripple.setView(v);
                }
            });
        }, { threshold: 0.6 });
        const _observeViews = () => document.querySelectorAll('[data-ripple-view]').forEach(el => io.observe(el));
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _observeViews);
        } else {
            _observeViews();
        }
    }


    // ── Auto-tracking: URL routing (History & Hash) ───────────────────────────
    function _autoViewFromUrl() {
        // e.g. /project-alpha/ripple/ or /dashboard?tab=active
        const path = location.pathname + location.search + location.hash;
        Ripple.setView(path);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoViewFromUrl);
    } else {
        _autoViewFromUrl();
    }

    window.addEventListener('hashchange', _autoViewFromUrl);
    window.addEventListener('popstate', _autoViewFromUrl);

    const _originalPushState = history.pushState;
    history.pushState = function() {
        const res = _originalPushState.apply(this, arguments);
        _autoViewFromUrl();
        return res;
    };

    const _originalReplaceState = history.replaceState;
    history.replaceState = function() {
        const res = _originalReplaceState.apply(this, arguments);
        _autoViewFromUrl();
        return res;
    };

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

    // ── UI Capture: CSS Selector Path Builder ─────────────────────────────────
    /**
     * Builds a unique CSS selector path for an element, walking up the DOM tree.
     * e.g. "body > div.top-bar > span#clock-days"
     * @param {Element} el
     * @returns {string}
     */
    function _getCssPath(el) {
        if (!el || el === document.body) return 'body';
        const parts = [];
        let node = el;
        while (node && node !== document.body && node.nodeType === 1) {
            let selector = node.tagName.toLowerCase();
            if (node.id) {
                selector += '#' + node.id;
                parts.unshift(selector);
                break; // ID is unique — stop walking
            } else {
                const classes = Array.from(node.classList)
                    .filter(c => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c))
                    .slice(0, 2)
                    .join('.');
                if (classes) selector += '.' + classes;
                parts.unshift(selector);
            }
            node = node.parentElement;
        }
        return 'body > ' + parts.join(' > ');
    }

    /**
     * Returns a short human-readable context string for the element.
     * e.g. "span#clock-days • classes: clock-label"
     * @param {Element} el
     * @returns {string}
     */
    function _getElementContext(el) {
        if (!el || el === document.body) return 'body (page-level)';
        const tag     = el.tagName.toLowerCase();
        const id      = el.id ? `#${el.id}` : '';
        const classes = el.className && typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).slice(0, 3).join(' ')
            : '';
        return `${tag}${id}${classes ? ' • ' + classes : ''}`;
    }

    // ── UI Capture: Shift + Right-Click interceptor ───────────────────────────
    document.addEventListener('contextmenu', function (e) {
        if (!e.shiftKey) return; // normal right-click — pass through
        e.preventDefault();
        // If in home/idle mode, instantly exit it and open prompt capture
        if (_homeMode) {
            _homeMode = false;
            localStorage.removeItem('ripple_home');
            _setIndicatorColor('prompt');
        }
        _openModal(e.target);
    }, true);

    // ── UI Capture: Modal ─────────────────────────────────────────────────────
    const CATEGORIES = ['fix', 'feature', 'design', 'copy', 'data', 'question'];
    const MODAL_ID   = '_rpl_capture_modal';

    function _openModal(targetEl) {
        if (_modalOpen) return;
        _modalOpen = true;

        const selectorPath  = _getCssPath(targetEl);
        const elementCtx    = _getElementContext(targetEl);
        const pageUrl       = location.href;

        // ── Inject styles ────────────────────────────────────────────────────
        if (!document.getElementById('_rpl_modal_styles')) {
            const style = document.createElement('style');
            style.id = '_rpl_modal_styles';
            style.textContent = `
                @keyframes _rpl_modal_in {
                    from { opacity: 0; transform: translate(-50%,-48%) scale(0.96); }
                    to   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
                }
                @keyframes _rpl_backdrop_in {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                #_rpl_backdrop {
                    position: fixed; inset: 0;
                    background: rgba(2, 2, 12, 0.72);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    z-index: 2147483645;
                    animation: _rpl_backdrop_in 0.18s ease;
                }
                #${MODAL_ID} {
                    position: fixed;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    width: min(480px, 92vw);
                    background: rgba(10, 10, 26, 0.97);
                    border: 1px solid rgba(100, 80, 200, 0.35);
                    border-radius: 16px;
                    box-shadow: 0 0 0 1px rgba(120,100,255,0.1),
                                0 24px 64px rgba(0,0,0,0.8),
                                0 0 40px rgba(90,60,180,0.15);
                    z-index: 2147483646;
                    font-family: 'Inter', system-ui, sans-serif;
                    animation: _rpl_modal_in 0.22s cubic-bezier(0.34,1.56,0.64,1);
                    overflow: hidden;
                }
                ._rpl_modal_header {
                    display: flex; align-items: center; gap: 10px;
                    padding: 16px 20px 14px;
                    border-bottom: 1px solid rgba(100,80,200,0.15);
                    background: rgba(20,16,40,0.9);
                }
                ._rpl_modal_body { padding: 16px 20px 20px; }
                ._rpl_ctx_pill {
                    display: inline-block;
                    background: rgba(80,60,160,0.2);
                    border: 1px solid rgba(100,80,200,0.25);
                    border-radius: 6px;
                    padding: 5px 10px;
                    font-size: 11px;
                    font-family: 'JetBrains Mono', 'Fira Code', monospace;
                    color: rgba(160,140,255,0.9);
                    margin-bottom: 12px;
                    word-break: break-all;
                    line-height: 1.5;
                    width: 100%;
                    box-sizing: border-box;
                }
                ._rpl_textarea {
                    width: 100%; box-sizing: border-box;
                    min-height: 96px;
                    background: rgba(20,20,50,0.9);
                    border: 1px solid rgba(100,80,200,0.2);
                    border-radius: 8px;
                    color: #e8e8f5;
                    font-family: 'Inter', system-ui, sans-serif;
                    font-size: 14px;
                    padding: 10px 12px;
                    resize: vertical;
                    line-height: 1.6;
                    outline: none;
                    transition: border-color 0.2s, box-shadow 0.2s;
                    margin-bottom: 10px;
                }
                ._rpl_textarea::placeholder { color: rgba(140,130,180,0.5); }
                ._rpl_textarea:focus {
                    border-color: rgba(120,90,220,0.55);
                    box-shadow: 0 0 0 3px rgba(100,70,200,0.12);
                }
                ._rpl_controls { display: flex; gap: 8px; align-items: center; }
                ._rpl_cat_select {
                    background: rgba(20,20,50,0.9);
                    border: 1px solid rgba(100,80,200,0.2);
                    color: #c0b8f0;
                    padding: 8px 10px;
                    border-radius: 8px;
                    font-size: 12px;
                    cursor: pointer;
                    flex-shrink: 0;
                    outline: none;
                }
                ._rpl_btn_send {
                    flex: 1;
                    background: linear-gradient(135deg, #7b5ea7, #4a2c8a);
                    border: none; color: white;
                    padding: 9px 18px; border-radius: 8px;
                    font-size: 13px; font-weight: 700;
                    cursor: pointer; letter-spacing: 0.02em;
                    transition: all 0.2s;
                    box-shadow: 0 0 20px rgba(100,70,200,0.35);
                }
                ._rpl_btn_send:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 0 30px rgba(100,70,200,0.55);
                }
                ._rpl_btn_send:disabled {
                    opacity: 0.5; cursor: not-allowed; transform: none;
                }
                ._rpl_btn_cancel {
                    background: transparent;
                    border: 1px solid rgba(255,255,255,0.1);
                    color: rgba(180,170,220,0.7);
                    padding: 9px 14px; border-radius: 8px;
                    font-size: 12px; cursor: pointer;
                    transition: all 0.2s;
                }
                ._rpl_btn_cancel:hover {
                    border-color: rgba(255,255,255,0.2);
                    color: rgba(220,210,255,0.9);
                }
                ._rpl_status {
                    margin-top: 10px; font-size: 11px;
                    text-align: center; min-height: 16px;
                    font-family: 'JetBrains Mono', monospace;
                }
                ._rpl_status.ok    { color: #3fb950; }
                ._rpl_status.error { color: #ff6b6b; }
            `;
            document.head.appendChild(style);
        }

        // ── Build backdrop ───────────────────────────────────────────────────
        const backdrop = document.createElement('div');
        backdrop.id = '_rpl_backdrop';
        backdrop.addEventListener('click', _closeModal);

        // ── Build modal ──────────────────────────────────────────────────────
        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Ripple UI Capture');

        // Ripple SVG logo (animated outward waves)
        const svgIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
            <circle cx="12" cy="12" r="3" fill="#a78bfa"/>
            <circle cx="12" cy="12" r="3" stroke="#a78bfa" stroke-width="1.2">
                <animate attributeName="r" values="3; 11" dur="2.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8; 0" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="12" cy="12" r="3" stroke="#a78bfa" stroke-width="1.2">
                <animate attributeName="r" values="3; 11" dur="2.5s" begin="0.83s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8; 0" dur="2.5s" begin="0.83s" repeatCount="indefinite" />
            </circle>
            <circle cx="12" cy="12" r="3" stroke="#a78bfa" stroke-width="1.2">
                <animate attributeName="r" values="3; 11" dur="2.5s" begin="1.66s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8; 0" dur="2.5s" begin="1.66s" repeatCount="indefinite" />
            </circle>
        </svg>`;

        // Category options
        const catOpts = CATEGORIES.map(c =>
            `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`
        ).join('');

        // ── Home mode: replace capture form with info card ───────────────────
        const modalBody = _homeMode ? `
            <div style="padding:16px 4px 4px; text-align:center;">
                <div style="font-size:28px; margin-bottom:8px;">⚪</div>
                <div style="color:#e8e8f5; font-weight:700; font-size:15px; margin-bottom:4px;">Home</div>
                <div style="color:rgba(140,130,200,0.7); font-size:11px; font-family:'JetBrains Mono',monospace; margin-bottom:16px;">
                    ${PROJECT_KEY} · ${RIPPLE_VERSION}
                </div>
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(100,80,200,0.15); border-radius:8px; padding:12px; text-align:left; font-size:11px; font-family:'JetBrains Mono',monospace; color:rgba(180,170,220,0.8); line-height:2;">
                    <div>📍 <strong>Page:</strong> ${pageUrl.replace(/^https?:\/\/[^/]+/, '').slice(0, 52) || '/'}</div>
                    <div>🎯 <strong>Session:</strong> ${_sessionId}</div>
                    <div>📦 <strong>Events logged:</strong> ${_events.length}</div>
                    <div>🔵 <strong>Prompt mode:</strong> off (idle)</div>
                    <div>🔴 <strong>Debug mode:</strong> ${DEBUG_MODE ? 'on' : 'off'}</div>
                </div>
                <div style="margin-top:14px; font-size:11px; color:rgba(120,110,160,0.6);">Shift+Right-Click any element to return to Prompt mode</div>
            </div>` : `
            <div class="_rpl_modal_body">
                <div class="_rpl_ctx_pill" title="${selectorPath}">${elementCtx}<br><span style="opacity:0.6">${selectorPath.slice(0, 72)}${selectorPath.length > 72 ? '…' : ''}</span></div>
                <textarea id="_rpl_prompt_text" class="_rpl_textarea" placeholder="Describe what you want to change or add here…" autofocus></textarea>
                <div class="_rpl_controls">
                    <select id="_rpl_cat_select" class="_rpl_cat_select" aria-label="Category">${catOpts}</select>
                    <button id="_rpl_btn_cancel" class="_rpl_btn_cancel">Cancel</button>
                    <button id="_rpl_btn_send" class="_rpl_btn_send">⚡ Send to AI Inbox</button>
                </div>
                <div id="_rpl_status" class="_rpl_status"></div>
            </div>`;

        // Nav acts as legend — active = current _indicatorState() only, others always clickable
        const _curState = _indicatorState(); // 'idle' | 'prompt' | 'debug'
        const navHome  = _curState === 'idle'
            ? `<span style="font-size:11px; color:#e8e8f5; font-weight:600; cursor:default;">⚪ Home</span>`
            : `<a id="_rpl_home_toggle" href="#" style="font-size:11px; color:rgba(220,215,235,0.55); text-decoration:none; cursor:pointer;">⚪ Home</a>`;
        const navPrompt = _curState === 'prompt'
            ? `<span style="font-size:11px; color:#58a6ff; font-weight:600; cursor:default;">🔵 Prompt</span>`
            : `<a id="_rpl_prompt_toggle" href="#" style="font-size:11px; color:#58a6ff; text-decoration:none; opacity:0.55; cursor:pointer;">🔵 Prompt</a>`;
        const navDebug  = _curState === 'debug'
            ? `<span style="font-size:11px; color:#ff6b6b; font-weight:600; cursor:default;">🔴 Debug</span>`
            : `<a id="_rpl_debug_toggle" href="#" style="font-size:11px; color:#ff6b6b; text-decoration:none; opacity:0.55; cursor:pointer;">🔴 Debug</a>`;

        modal.innerHTML = `
            <div class="_rpl_modal_header">
                <a href="${PROJECT_PATH}/ripple/" target="_blank" style="display:flex;align-items:center;text-decoration:none;" title="Dashboard">
                    ${svgIcon}
                </a>
                <div>
                    <div style="color:#e8e8f5;font-weight:700;font-size:14px;line-height:1.2;">Ripple UI Capture <span style="font-size:10px; color:rgba(140,130,200,0.8); font-weight:normal;">${RIPPLE_VERSION}</span></div>
                    <div style="color:rgba(140,130,200,0.7);font-size:10px;font-family:'JetBrains Mono',monospace;margin-top:2px;">${PROJECT_KEY} · ${pageUrl.replace(/^https?:\/\/[^/]+/, '').slice(0, 48) || '/'}</div>
                </div>
                <button id="_rpl_close_x" style="margin-left:auto;background:transparent;border:none;color:rgba(180,170,220,0.5);font-size:20px;cursor:pointer;line-height:1;padding:0 4px;transition:color 0.2s;" aria-label="Close">&times;</button>
            </div>
            ${modalBody}
            <div style="margin-top:12px; padding:8px 12px; background:rgba(255,255,255,0.03); border:1px solid rgba(100,80,200,0.12); border-radius:8px; display:flex; justify-content:center; align-items:center; gap:20px;">
                <a href="${PROJECT_PATH}/ripple/" target="_blank" style="font-size:11px; color:rgba(140,130,220,0.6); text-decoration:underline;">Dashboard</a>
                <span style="color:rgba(80,70,120,0.3); font-size:10px;">|</span>
                ${navHome}
                <span style="color:rgba(80,70,120,0.3); font-size:10px;">·</span>
                ${navPrompt}
                <span style="color:rgba(80,70,120,0.3); font-size:10px;">·</span>
                ${navDebug}
            </div>
            <div style="margin-top:8px;font-size:10px;color:rgba(120,110,170,0.5);text-align:center;font-family:'JetBrains Mono',monospace;">Shift+Enter to submit · Esc to close</div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        // Focus textarea
        const textarea = document.getElementById('_rpl_prompt_text');
        setTimeout(() => textarea && textarea.focus(), 80);

        // ── Wire close actions ───────────────────────────────────────────────
        document.getElementById('_rpl_close_x').addEventListener('click', _closeModal);
        const _cancelBtn = document.getElementById('_rpl_btn_cancel');
        if (_cancelBtn) _cancelBtn.addEventListener('click', _closeModal);

        // Home toggle (go idle / exit idle)
        const _homeBtn = document.getElementById('_rpl_home_toggle');
        if (_homeBtn) _homeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            _closeModal();
            Ripple.home.toggle();
        });

        // Prompt toggle (exit home or debug → back to prompt)
        const _promptBtn = document.getElementById('_rpl_prompt_toggle');
        if (_promptBtn) _promptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            _closeModal();
            if (_homeMode)  Ripple.home.disable();
            if (DEBUG_MODE) Ripple.debug.disable();
        });

        // Debug toggle — exits home mode first if active
        const _debugBtn = document.getElementById('_rpl_debug_toggle');
        if (_debugBtn) _debugBtn.addEventListener('click', (e) => {
            e.preventDefault();
            _closeModal();
            if (_homeMode) localStorage.removeItem('ripple_home'); // exit home before entering debug
            Ripple.debug.toggle();
        });

        // Esc key
        const _escHandler = (e) => { if (e.key === 'Escape') _closeModal(); };
        document.addEventListener('keydown', _escHandler, { once: true });

        // Shift+Enter submit (prompt mode only)
        if (!_homeMode && textarea) {
            textarea.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    document.getElementById('_rpl_btn_send').click();
                }
            });
        }

        // ── Wire send ────────────────────────────────────────────────────────
        document.getElementById('_rpl_btn_send').addEventListener('click', function () {
            const text     = textarea.value.trim();
            const category = document.getElementById('_rpl_cat_select').value;
            const statusEl = document.getElementById('_rpl_status');

            if (!text) {
                statusEl.textContent = '⚠ Please enter a prompt.';
                statusEl.className   = '_rpl_status error';
                textarea.focus();
                return;
            }

            const btn = document.getElementById('_rpl_btn_send');
            btn.disabled    = true;
            btn.textContent = 'Sending…';
            statusEl.textContent = '';

            const capturePayload = {
                projectKey:      PROJECT_KEY,
                pageUrl:         pageUrl,
                elementSelector: selectorPath,
                elementContext:  elementCtx,
                category:        category,
                prompt:          text,
                sessionId:       _sessionId,
                timestamp:       new Date().toISOString(),
            };

            fetch(CAPTURE_EP, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(capturePayload),
            })
            .then(r => r.json())
            .then(data => {
                if (data.ok) {
                    statusEl.textContent = `✓ Saved → ${data.promptId}`;
                    statusEl.className   = '_rpl_status ok';
                    Ripple.track('prompt_captured', {
                        promptId:  data.promptId,
                        category:  category,
                        element:   elementCtx.slice(0, 60),
                        promptLen: text.length,
                    });
                    window.dispatchEvent(new CustomEvent('ripplePromptSaved'));
                    setTimeout(_closeModal, 1400);
                } else {
                    throw new Error(data.error || 'Unknown error');
                }
            })
            .catch(err => {
                statusEl.textContent = `✗ Error: ${err.message}`;
                statusEl.className   = '_rpl_status error';
                btn.disabled    = false;
                btn.textContent = '⚡ Send to AI Inbox';
            });
        });
    }

    function _closeModal() {
        const modal    = document.getElementById(MODAL_ID);
        const backdrop = document.getElementById('_rpl_backdrop');
        if (modal)    modal.remove();
        if (backdrop) backdrop.remove();
        _modalOpen = false;
    }

    // ── UI Capture: Floating Indicator Icon ───────────────────────────────────
    //
    // Three states:
    //   idle   — white  — tracker loaded, no active mode
    //   prompt — blue   — prompt capture mode (default when tracker is active)
    //   debug  — red    — ?ripple_debug=1 or localStorage ripple_debug=true

    const INDICATOR_COLORS = {
        idle:   { fill: '#e8e8f5', stroke: '#c0b8d8', label: '⚪ Idle — click to open' },
        prompt: { fill: '#388bfd', stroke: '#58a6ff', label: '🔵 Prompt Mode — Shift+Right-Click any element' },
        debug:  { fill: '#ff6b6b', stroke: '#f85149', label: '🔴 Debug Mode — live event stream active' },
    };

    function _indicatorState() {
        if (_homeMode)  return 'idle';
        if (DEBUG_MODE) return 'debug';
        return 'prompt';
    }

    function _setIndicatorColor(state) {
        const ind = document.getElementById('_rpl_indicator');
        if (!ind) return;
        const cfg = INDICATOR_COLORS[state] || INDICATOR_COLORS.prompt;
        // Update all circle fill/stroke colours inside the SVG
        ind.querySelectorAll('circle').forEach((c, i) => {
            if (i === 0) {
                c.setAttribute('fill', cfg.fill);
            } else {
                c.setAttribute('stroke', cfg.stroke);
            }
        });
        // Update tooltip
        const tip = ind.querySelector('[data-rpl-tooltip]');
        if (tip) tip.textContent = `Ripple ${RIPPLE_VERSION} · ${cfg.label}`;
    }

    function _buildIndicator() {
        const state = _indicatorState();
        const cfg   = INDICATOR_COLORS[state];

        const svgMarkup = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="3" fill="${cfg.fill}"/>
            <circle cx="12" cy="12" r="3" stroke="${cfg.stroke}" stroke-width="1.2">
                <animate attributeName="r" values="3; 11" dur="2.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8; 0" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="12" cy="12" r="3" stroke="${cfg.stroke}" stroke-width="1.2">
                <animate attributeName="r" values="3; 11" dur="2.5s" begin="0.83s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8; 0" dur="2.5s" begin="0.83s" repeatCount="indefinite" />
            </circle>
            <circle cx="12" cy="12" r="3" stroke="${cfg.stroke}" stroke-width="1.2">
                <animate attributeName="r" values="3; 11" dur="2.5s" begin="1.66s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8; 0" dur="2.5s" begin="1.66s" repeatCount="indefinite" />
            </circle>
        </svg>`;

        const indicator = document.createElement('div');
        indicator.id = '_rpl_indicator';
        indicator.setAttribute('role', 'button');
        indicator.setAttribute('aria-label', 'Ripple — click to open prompt');
        indicator.setAttribute('tabindex', '0');
        indicator.style.cssText = [
            'position:fixed', 'bottom:20px', 'right:20px',
            'width:88px', 'height:88px',
            'display:flex', 'align-items:center', 'justify-content:center',
            'cursor:pointer',
            'opacity:0.70',
            'transition:opacity 0.25s ease, transform 0.25s ease',
            'z-index:2147483644',
            'border-radius:50%',
            'user-select:none',
        ].join(';');

        // Tooltip
        const tooltip = document.createElement('div');
        tooltip.setAttribute('data-rpl-tooltip', '1');
        tooltip.style.cssText = [
            'position:absolute', 'bottom:calc(100% + 8px)', 'right:0',
            'background:rgba(10,10,26,0.97)',
            'border:1px solid rgba(100,80,200,0.35)',
            'border-radius:8px', 'padding:6px 10px',
            'font-family:\'Inter\',system-ui,sans-serif',
            'font-size:11px', 'color:rgba(200,190,255,0.9)',
            'white-space:nowrap', 'pointer-events:none',
            'opacity:0', 'transition:opacity 0.2s',
            'box-shadow:0 4px 16px rgba(0,0,0,0.6)',
        ].join(';');
        tooltip.textContent = `Ripple ${RIPPLE_VERSION} · ${cfg.label}`;

        indicator.appendChild(tooltip);
        indicator.innerHTML += svgMarkup;
        document.body.appendChild(indicator);

        // Hover effects
        indicator.addEventListener('mouseenter', () => {
            indicator.style.opacity   = '0.95';
            indicator.style.transform = 'scale(1.15)';
            tooltip.style.opacity     = '1';
        });
        indicator.addEventListener('mouseleave', () => {
            indicator.style.opacity   = '0.70';
            indicator.style.transform = 'scale(1)';
            tooltip.style.opacity     = '0';
        });

        // Click → open modal targeting body
        indicator.addEventListener('click', (e) => {
            e.stopPropagation();
            _openModal(document.body);
        });
        indicator.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                _openModal(document.body);
            }
        });
    }

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
            'position:fixed', 'bottom:60px', 'right:20px', 'width:370px',
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

        // Toggle collapse/expand — tracked as an event so session data captures
        // whether the developer actively monitors the overlay or hides it away.
        let _collapsed = false;
        document.getElementById('_rpl_toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            _collapsed = !_collapsed;
            document.getElementById('_rpl_body').style.display = _collapsed ? 'none' : 'block';
            document.getElementById('_rpl_toggle').textContent = _collapsed ? '+' : '−';
            panel.style.maxHeight = _collapsed ? '37px' : '440px';
            Ripple.track('debug_panel_toggled', { state: _collapsed ? 'collapsed' : 'expanded' });
        });

        // Flush pending logs
        _pendingLog.forEach(_renderLogEntry);
        _pendingLog.length = 0;

        _debugLog('tracker_ready', { project: PROJECT_KEY, endpoint: ENDPOINT }, 'sys');
        _updateCount();
    }

    if (DEBUG_MODE && !_homeMode) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _buildDebugOverlay);
        } else {
            _buildDebugOverlay();
        }
    }

    // ── Boot: inject indicator after DOM is ready ─────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _buildIndicator);
    } else {
        _buildIndicator();
    }

    // ── Expose ────────────────────────────────────────────────────────────────
    global.Ripple = Ripple;

})(window);
