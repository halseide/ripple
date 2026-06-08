<?php
/**
 * Ripple Customer Dashboard
 * ─────────────────────────
 * URL: /ripple/dashboard.php?project=KEY
 *
 * Serves a project-scoped analytics view filtered to a single projectKey.
 * Data is read from the Ripple data layer (sessions, prompt_log.json,
 * project_analytics.json) — no separate database required.
 *
 * Security: projectKey is validated against ripple.config.json.
 * Unknown keys return 404. Data from other projects is never exposed.
 */

header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');

// ── Resolve config ─────────────────────────────────────────────────────────
$configPath = __DIR__ . '/ripple.config.json';
if (!file_exists($configPath)) {
    http_response_code(503);
    die('Ripple config not found.');
}
$config  = json_decode(file_get_contents($configPath), true);
$projects = $config['projects'] ?? [];

// ── Validate project key ────────────────────────────────────────────────────
$requestedKey = trim($_GET['project'] ?? '');
if ($requestedKey === '') {
    header("Location: /ripple/src/dashboard/");
    exit;
}

$project = null;
foreach ($projects as $p) {
    if ($p['key'] === $requestedKey) {
        $project = $p;
        break;
    }
}
if (!$project) {
    http_response_code(404);
    die("Project '$requestedKey' not found in Ripple config.");
}

$projectKey  = htmlspecialchars($project['key']);
$projectName = htmlspecialchars($project['name']);
$projectUrl  = htmlspecialchars($project['url'] ?? '');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= $projectName ?> — Ripple Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-base:      #0a0e17;
      --bg-surface:   #0f1520;
      --bg-panel:     rgba(255,255,255,0.03);
      --bg-input:     rgba(255,255,255,0.05);
      --glass-border: rgba(255,255,255,0.07);
      --neon-teal:    #00d4aa;
      --neon-purple:  #7b5ea7;
      --neon-rose:    #f43f5e;
      --neon-amber:   #eab308;
      --text-primary: #f0f6fc;
      --text-secondary:#8b949e;
      --text-dim:     #4a5568;
      --radius:       10px;
      --font-main:    'Inter', system-ui, sans-serif;
      --font-mono:    'JetBrains Mono', monospace;
    }

    body {
      background: var(--bg-base);
      color: var(--text-primary);
      font-family: var(--font-main);
      min-height: 100vh;
      padding: 0;
    }

    /* ── Header ── */
    .rpl-header {
      background: linear-gradient(135deg, rgba(123,94,167,0.12), rgba(0,212,170,0.06));
      border-bottom: 1px solid var(--glass-border);
      padding: 18px 32px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .rpl-logo {
      width: 36px; height: 36px;
      background: rgba(123,94,167,0.2);
      border: 1px solid rgba(123,94,167,0.4);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }
    .rpl-header-text h1 {
      font-size: 17px; font-weight: 600;
      color: var(--text-primary);
    }
    .rpl-header-text p {
      font-size: 12px; color: var(--text-secondary);
      font-family: var(--font-mono);
    }
    .rpl-badge {
      margin-left: auto;
      background: rgba(0,212,170,0.1);
      border: 1px solid rgba(0,212,170,0.25);
      color: var(--neon-teal);
      font-size: 10px; font-family: var(--font-mono);
      text-transform: uppercase; letter-spacing: 0.08em;
      padding: 4px 10px; border-radius: 20px;
    }
    .rpl-back {
      color: var(--text-dim);
      font-size: 11px; font-family: var(--font-mono);
      text-decoration: none;
      padding: 4px 10px;
      border: 1px solid var(--glass-border);
      border-radius: 6px;
      transition: color 0.2s, border-color 0.2s;
    }
    .rpl-back:hover { color: var(--text-primary); border-color: rgba(255,255,255,0.2); }

    /* ── Main grid ── */
    .rpl-main {
      padding: 24px 32px;
      max-width: 1400px;
      margin: 0 auto;
    }

    /* ── Stat row ── */
    .stat-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg-panel);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 16px 20px;
    }
    .stat-label {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--text-dim); margin-bottom: 8px;
    }
    .stat-value {
      font-size: 28px; font-weight: 700;
      font-family: var(--font-mono);
      color: var(--text-primary);
    }
    .stat-value.teal { color: var(--neon-teal); }
    .stat-value.purple { color: var(--neon-purple); }
    .stat-sub {
      font-size: 11px; color: var(--text-dim);
      margin-top: 4px; font-family: var(--font-mono);
    }

    /* ── Panels ── */
    .panel-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .panel-row.thirds {
      grid-template-columns: 2fr 1fr;
    }
    .panel {
      background: var(--bg-panel);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 18px 20px;
    }
    .panel-title {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--text-dim); margin-bottom: 14px;
      display: flex; align-items: center; gap: 8px;
    }
    .panel-title span { font-size: 13px; }

    /* ── Sessions list ── */
    .session-list { display: flex; flex-direction: column; gap: 8px; }
    .session-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--glass-border);
      border-radius: 6px;
      font-size: 12px;
    }
    .session-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--neon-teal); flex-shrink: 0;
    }
    .session-dot.ghost { background: var(--text-dim); }
    .session-id { font-family: var(--font-mono); color: var(--text-secondary); flex: 1; }
    .session-time { color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; }
    .session-dur { color: var(--neon-teal); font-family: var(--font-mono); font-size: 11px; }

    /* ── Prompts ── */
    .prompt-list { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; }
    .prompt-item {
      padding: 10px 12px;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--glass-border);
      border-left: 3px solid var(--neon-purple);
      border-radius: 6px;
    }
    .prompt-item.shipped { border-left-color: var(--neon-teal); }
    .prompt-item.wont_fix { border-left-color: var(--text-dim); }
    .prompt-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 5px; }
    .prompt-status {
      font-size: 9px; padding: 2px 7px; border-radius: 10px;
      text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
      font-family: var(--font-mono);
    }
    .prompt-status.shipped { background: rgba(0,212,170,0.12); color: var(--neon-teal); }
    .prompt-status.pending { background: rgba(123,94,167,0.15); color: var(--neon-purple); }
    .prompt-status.wont_fix { background: rgba(255,255,255,0.05); color: var(--text-dim); }
    .prompt-status.answered { background: rgba(234,179,8,0.12); color: var(--neon-amber); }
    .prompt-date { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); }
    .prompt-hash { font-size: 10px; color: var(--neon-teal); font-family: var(--font-mono); }
    .prompt-text { font-size: 12px; color: var(--text-primary); line-height: 1.5; }

    /* ── Events ── */
    .event-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .event-name { font-size: 12px; color: var(--text-secondary); flex: 1; font-family: var(--font-mono); }
    .event-bar-track { flex: 2; height: 5px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; }
    .event-bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--neon-purple), var(--neon-teal)); }
    .event-count { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); width: 32px; text-align: right; }

    /* ── Empty / loading ── */
    .empty { color: var(--text-dim); font-size: 13px; text-align: center; padding: 24px 0; }
    .loading { color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }

    /* ── Footer ── */
    .rpl-footer {
      text-align: center; padding: 20px;
      font-size: 10px; color: var(--text-dim);
      font-family: var(--font-mono);
      border-top: 1px solid var(--glass-border);
      margin-top: 8px;
    }
    .rpl-footer a { color: var(--neon-purple); text-decoration: none; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: var(--glass-border); border-radius: 2px; }
  </style>
</head>
<body>

<header class="rpl-header">
  <div class="rpl-logo">〜</div>
  <div class="rpl-header-text">
    <h1><?= $projectName ?></h1>
    <p>ripple · project dashboard · <?= $projectKey ?></p>
  </div>
  <span class="rpl-badge">self-hosted</span>
  <?php if ($projectUrl): ?>
    <a class="rpl-back" href="<?= $projectUrl ?>" target="_blank">↗ Live Site</a>
  <?php endif; ?>
  <a class="rpl-back" href="/ripple/src/dashboard/" style="margin-left:8px">← Ripple Platform</a>
</header>

<main class="rpl-main">

  <!-- Stats row: loaded via JS -->
  <div class="stat-row" id="stat-row">
    <div class="stat-card"><div class="stat-label">Sessions (All Time)</div><div class="stat-value teal" id="stat-sessions">—</div><div class="stat-sub">unique sessions</div></div>
    <div class="stat-card"><div class="stat-label">Prompts Captured</div><div class="stat-value purple" id="stat-prompts">—</div><div class="stat-sub">via Ripple UI</div></div>
    <div class="stat-card"><div class="stat-label">Shipped</div><div class="stat-value teal" id="stat-shipped">—</div><div class="stat-sub">prompts resolved</div></div>
    <div class="stat-card"><div class="stat-label">Avg Session</div><div class="stat-value" id="stat-avg">—</div><div class="stat-sub">seconds</div></div>
  </div>

  <!-- Sessions + Prompts -->
  <div class="panel-row thirds">
    <div class="panel">
      <div class="panel-title"><span>🎯</span> Captured Prompts</div>
      <div class="prompt-list" id="prompt-list"><div class="loading">loading…</div></div>
    </div>
    <div class="panel">
      <div class="panel-title"><span>⚡</span> Top Events</div>
      <div id="event-list"><div class="loading">loading…</div></div>
    </div>
  </div>

  <div class="panel-row">
    <div class="panel">
      <div class="panel-title"><span>🕐</span> Recent Sessions</div>
      <div class="session-list" id="session-list"><div class="loading">loading…</div></div>
    </div>
    <div class="panel" style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;">
      <div style="font-size:36px;">〜</div>
      <div style="font-size:13px;color:var(--text-secondary);text-align:center;">
        Ripple is tracking <strong style="color:var(--neon-teal)"><?= $projectName ?></strong>.<br>
        Data stays on your server.
      </div>
      <div style="font-size:10px;color:var(--text-dim);font-family:var(--font-mono);">
        self-hosted · <?= $projectKey ?> · <?= date('Y-m-d') ?>
      </div>
    </div>
  </div>

</main>

<footer class="rpl-footer">
  Powered by <a href="/ripple/src/dashboard/">Ripple</a> — self-hosted session intelligence ·
  Project: <strong><?= $projectKey ?></strong>
</footer>

<script>
const PROJECT_KEY = <?= json_encode($projectKey) ?>;
const API_BASE    = '/ripple/';

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmt(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? s + 's' : Math.round(s / 60) + 'm ' + (s % 60) + 's';
}
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

async function load() {
  // ── Prompt log ───────────────────────────────────────────────────────────
  try {
    const prompts = await fetch(API_BASE + 'data/prompt_log.json').then(r => r.json());
    const mine = Array.isArray(prompts)
      ? prompts.filter(p => p.projectKey === PROJECT_KEY)
      : [];

    document.getElementById('stat-prompts').textContent = mine.length;
    document.getElementById('stat-shipped').textContent = mine.filter(p => p.status === 'shipped').length;

    const pl = document.getElementById('prompt-list');
    if (mine.length === 0) {
      pl.innerHTML = '<div class="empty">No prompts captured yet.<br>Shift+Right-Click any element to capture one.</div>';
    } else {
      pl.innerHTML = mine.slice(0, 20).map(p => {
        const date = p.capturedAt ? new Date(p.capturedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        return `<div class="prompt-item ${esc(p.status||'pending')}">
          <div class="prompt-meta">
            <span class="prompt-status ${esc(p.status||'pending')}">${esc(p.status||'pending')}</span>
            <span class="prompt-date">${date}</span>
            ${p.commitHash ? `<span class="prompt-hash">${esc(p.commitHash)}</span>` : ''}
          </div>
          <div class="prompt-text">${esc(p.prompt||'')}</div>
        </div>`;
      }).join('');
    }
  } catch(e) {
    document.getElementById('prompt-list').innerHTML = '<div class="empty">Could not load prompt log.</div>';
  }

  // ── Project analytics ─────────────────────────────────────────────────────
  try {
    const analytics = await fetch(API_BASE + 'data/project_analytics.json').then(r => r.json());
    const proj = (analytics.projects || []).find(p => p.key === PROJECT_KEY);

    if (proj) {
      document.getElementById('stat-sessions').textContent = proj.total_sessions ?? '—';
      document.getElementById('stat-avg').textContent     = proj.avg_duration_s ? Math.round(proj.avg_duration_s) + 's' : '—';

      // Events
      const events = proj.event_counts || {};
      const sorted = Object.entries(events).sort((a,b) => b[1] - a[1]);
      const maxEvt  = sorted.length > 0 ? sorted[0][1] : 1;
      const el = document.getElementById('event-list');
      if (sorted.length === 0) {
        el.innerHTML = '<div class="empty">No events recorded yet.</div>';
      } else {
        el.innerHTML = sorted.slice(0, 8).map(([name, count]) => `
          <div class="event-row">
            <span class="event-name">${esc(name)}</span>
            <div class="event-bar-track"><div class="event-bar-fill" style="width:${(count/maxEvt*100).toFixed(0)}%"></div></div>
            <span class="event-count">${count}</span>
          </div>`).join('');
      }
    }
  } catch(e) { /* analytics not available */ }

  // ── Recent sessions ───────────────────────────────────────────────────────
  try {
    const sessionsDir = API_BASE + 'api/session.php?list=1&project=' + encodeURIComponent(PROJECT_KEY);
    // Fall back to listing session files via a simple endpoint
    // For now render a placeholder — full session listing requires a list endpoint
    document.getElementById('stat-sessions').textContent = document.getElementById('stat-sessions').textContent || '—';
    const sl = document.getElementById('session-list');
    sl.innerHTML = '<div class="empty" style="font-size:11px">Session list requires <code>api/sessions_list.php</code> endpoint.<br>Coming in next Ripple release.</div>';
  } catch(e) {}
}

load();
</script>
</body>
</html>
