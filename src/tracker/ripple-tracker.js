/**
 * Ripple Tracker  v0.3.0
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
    
    const RIPPLE_VERSION = 'v0.3.0';

    // ── Config from <script> tag ──────────────────────────────────────────────
    const _script      = document.currentScript;
    const PROJECT_KEY  = (_script && _script.getAttribute('data-ripple-key'))      || 'unknown';
    const PROJECT_PATH = (_script && _script.getAttribute('data-ripple-path'))     || `/${PROJECT_KEY}`;
    const ENDPOINT     = (_script && _script.getAttribute('data-ripple-endpoint')) || '/api/session.php';
    const CAPTURE_EP   = '/ripple/api/capture_prompt.php';
    const DEBUG_MODE   = new URLSearchParams(location.search).has('ripple_debug') ||
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
    };

    // ── Auto-tracking: page load ──────────────────────────────────────────────
    Ripple.track('page_loaded', { href: location.href });

    // ── Auto-tracking: [data-ripple-event] clicks ─────────────────────────────
    document.addEventListener('click', function (e) {
        // 1. Check for explicit manual tags (highest priority)
        const explicitEl = e.target.closest('[data-ripple-event]');
        if (explicitEl) {
            const name = explicitEl.getAttribute('data-ripple-event');
            const label = explicitEl.getAttribute('data-ripple-label') || explicitEl.textContent.trim().slice(0, 80);
            Ripple.track(name, { label, element: explicitEl.tagName.toLowerCase() });
            return;
        }

        // 2. Auto-capture generic clicks on interactive elements
        const interactiveEl = e.target.closest('button, a, input[type="submit"], input[type="button"], [role="button"], .panel-action, .gran-btn, .nav-item, .rt-arrow');
        if (interactiveEl) {
            let label = interactiveEl.textContent.trim().slice(0, 80);
            if (!label && interactiveEl.id) label = '#' + interactiveEl.id;
            if (!label && interactiveEl.className) label = '.' + interactiveEl.className.split(' ')[0];
            if (!label && interactiveEl.title) label = interactiveEl.title;
            
            // Format label nicely
            if (label && typeof label === 'string') {
                label = label.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
            }

            const tagName = interactiveEl.tagName.toLowerCase();
            let eventName = 'interaction';
            if (tagName === 'a') eventName = 'link_clicked';
            else if (tagName === 'button') eventName = 'button_clicked';

            Ripple.track(eventName, { 
                label: label || 'unnamed', 
                element: tagName,
                id: interactiveEl.id || undefined,
                class: interactiveEl.className || undefined,
                href: interactiveEl.getAttribute('href') || undefined
            });
        }
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
            <div class="_rpl_modal_body">
                <div class="_rpl_ctx_pill" title="${selectorPath}">${elementCtx}<br><span style="opacity:0.6">${selectorPath.slice(0, 72)}${selectorPath.length > 72 ? '…' : ''}</span></div>
                <textarea id="_rpl_prompt_text" class="_rpl_textarea" placeholder="Describe what you want to change or add here…" autofocus></textarea>
                <div class="_rpl_controls">
                    <select id="_rpl_cat_select" class="_rpl_cat_select" aria-label="Category">${catOpts}</select>
                    <button id="_rpl_btn_cancel" class="_rpl_btn_cancel">Cancel</button>
                    <button id="_rpl_btn_send" class="_rpl_btn_send">⚡ Send to AI Inbox</button>
                </div>
                <div id="_rpl_status" class="_rpl_status"></div>
                <div style="margin-top:12px; text-align:center;">
                    <a href="${PROJECT_PATH}/ripple/" target="_blank" style="font-size:11px; color:rgba(140,130,220,0.8); text-decoration:underline;">View AI Inbox (Dashboard)</a>
                </div>
                <div style="margin-top:8px;font-size:10px;color:rgba(120,110,170,0.5);text-align:center;font-family:'JetBrains Mono',monospace;">Shift+Enter to submit · Esc to close</div>
            </div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        // Focus textarea
        const textarea = document.getElementById('_rpl_prompt_text');
        setTimeout(() => textarea && textarea.focus(), 80);

        // ── Wire close actions ───────────────────────────────────────────────
        document.getElementById('_rpl_close_x').addEventListener('click', _closeModal);
        document.getElementById('_rpl_btn_cancel').addEventListener('click', _closeModal);

        // Esc key
        const _escHandler = (e) => { if (e.key === 'Escape') _closeModal(); };
        document.addEventListener('keydown', _escHandler, { once: true });

        // Shift+Enter submit
        textarea.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                document.getElementById('_rpl_btn_send').click();
            }
        });

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
    function _buildIndicator() {
        const svgMarkup = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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

        const indicator = document.createElement('div');
        indicator.id = '_rpl_indicator';
        indicator.setAttribute('role', 'button');
        indicator.setAttribute('aria-label', 'Ripple Active — click to open prompt');
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
        tooltip.textContent = 'Ripple Active — Shift+Right-Click any element to modify';

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

    if (DEBUG_MODE) {
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
