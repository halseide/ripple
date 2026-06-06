<?php
/**
 * Ripple Stats Page (The Friction Lifecycle)
 * ─────────────────────────
 * URL: /ripple/stats.php
 *
 * Visualizes the Velocity of Iteration across all projects.
 */

header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');

$configPath = __DIR__ . '/ripple.config.json';
$projects = [];
if (file_exists($configPath)) {
    $config = json_decode(file_get_contents($configPath), true);
    $projects = $config['projects'] ?? [];
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ripple Stats — Friction Lifecycle</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-base:      #0a0e17;
      --bg-surface:   #0f1520;
      --bg-panel:     rgba(255,255,255,0.03);
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
    .rpl-controls {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    select.project-filter {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      padding: 6px 12px;
      border-radius: 6px;
      font-family: var(--font-main);
      font-size: 13px;
      cursor: pointer;
      outline: none;
    }
    select.project-filter:focus { border-color: var(--neon-teal); }
    select.project-filter option {
      background: var(--bg-surface);
      color: var(--text-primary);
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
    #echart-ripple-stats {
      width: 100%;
      height: 250px;
    }
    #echart-ripple-scatter {
      width: 100%;
      height: 350px;
    }
    
    /* ── Flow grid ── */
    .flow-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      margin-top: 24px;
      display: none; /* hidden until loaded */
    }
    .flow-list {
      list-style: none;
      margin-top: 10px;
    }
    .flow-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid var(--glass-border);
      font-size: 13px;
    }
    .flow-item:last-child { border-bottom: none; }
    .flow-item-name { color: var(--text-primary); font-family: var(--font-mono); }
    .flow-item-count { color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: var(--font-mono); }
  </style>
</head>
<body>

<header class="rpl-header">
  <div class="rpl-logo">〜</div>
  <div class="rpl-header-text">
    <h1 id="headerTitle">Global Stats</h1>
    <p>ripple · the friction lifecycle</p>
  </div>
  <div class="rpl-controls">
    <select id="projectFilter" class="project-filter" onchange="resetInterventionAndLoad()">
      <option value="">All Projects (Global)</option>
      <?php foreach ($projects as $p): ?>
        <option value="<?= htmlspecialchars($p['key']) ?>"><?= htmlspecialchars($p['name']) ?></option>
      <?php endforeach; ?>
    </select>
    <select id="interventionFilter" class="project-filter" style="display:none;" onchange="loadChart()">
      <option value="">Select Shipped Change to Measure...</option>
    </select>
    <a class="rpl-back" href="/ripple/src/dashboard/">← Ripple Platform</a>
  </div>
</header>

<main class="rpl-main">
  <div class="panel">
    <div class="panel-title"><span>📈</span> Velocity of Iteration (Friction Lifecycle)</div>
    <div id="echart-ripple-stats"></div>
  </div>

  <div class="panel" style="margin-top: 24px;">
    <div class="panel-title"><span>🎯</span> Session Behavior Scatter (Duration vs Outcome)</div>
    <div style="font-size: 11px; color: var(--text-dim); margin-top: -10px; margin-bottom: 10px;">
      <span style="color:#00d4aa; font-weight:600;">● Engaged</span> &nbsp; | &nbsp; 
      <span style="color:#f43f5e; font-weight:600;">● Bounced</span> &nbsp; | &nbsp; 
      <span style="color:#8b949e; font-weight:600;">● Glancer</span> &nbsp; | &nbsp; 
      <span style="color:#7b5ea7; font-weight:600;">| Deployments</span>
    </div>
    <div id="echart-ripple-scatter"></div>
  </div>

  <div class="flow-grid" id="flowGrid">
    <div class="panel">
      <div class="panel-title"><span>🚪</span> Top Referrers (Entry)</div>
      <ul class="flow-list" id="referrersList"></ul>
    </div>
    <div class="panel">
      <div class="panel-title"><span>🛤️</span> Top Navigation Paths</div>
      <ul class="flow-list" id="pathsList"></ul>
    </div>
    <div class="panel">
      <div class="panel-title"><span>📉</span> View Dropoff (Funnel)</div>
      <ul class="flow-list" id="funnelList"></ul>
    </div>
  </div>
</main>

<script>
let myChart = null;
let myScatterChart = null;

function resetInterventionAndLoad() {
    const intSel = document.getElementById('interventionFilter');
    intSel.value = '';
    loadChart();
}

async function loadChart() {
    const projectKey = document.getElementById('projectFilter').value;
    const interventionId = document.getElementById('interventionFilter').value;
    const headerTitle = document.getElementById('headerTitle');
    
    if (projectKey) {
        const sel = document.getElementById('projectFilter');
        headerTitle.innerText = sel.options[sel.selectedIndex].text + ' Stats';
    } else {
        headerTitle.innerText = 'Global Stats';
    }

    const chartDom = document.getElementById('echart-ripple-stats');
    if (!myChart) {
        myChart = echarts.init(chartDom, 'dark');
        window.addEventListener('resize', function() { myChart.resize(); });
    }
    
    const scatterDom = document.getElementById('echart-ripple-scatter');
    if (!myScatterChart) {
        myScatterChart = echarts.init(scatterDom, 'dark');
        window.addEventListener('resize', function() { myScatterChart.resize(); });
        
        // Link the charts so zooming one zooms both
        echarts.connect([myChart, myScatterChart]);
    }

    myChart.showLoading({ color: '#00d4aa', maskColor: 'rgba(10,14,23,0.8)' });
    myScatterChart.showLoading({ color: '#00d4aa', maskColor: 'rgba(10,14,23,0.8)' });

    try {
        let url = '/ripple/api/stats_data.php';
        if (projectKey) url += `?project=${encodeURIComponent(projectKey)}`;
        if (interventionId) url += `&intervention=${encodeURIComponent(interventionId)}`;
        
        const data = await fetch(url).then(r => r.json());
        
        // Populate interventions dropdown if available
        const intSel = document.getElementById('interventionFilter');
        if (projectKey && !interventionId && data.availableInterventions) {
            intSel.style.display = 'block';
            let html = '<option value="">Select Shipped Change to Measure...</option>';
            data.availableInterventions.forEach(inv => {
                html += `<option value="${inv.id}">${inv.text}</option>`;
            });
            intSel.innerHTML = html;
        } else if (!projectKey) {
            intSel.style.display = 'none';
            intSel.value = '';
        }

        // Render Traffic Flow panels
        const flowGrid = document.getElementById('flowGrid');
        if (projectKey && data.topReferrers && data.navigationPaths) {
            flowGrid.style.display = 'grid';
            
            const refList = document.getElementById('referrersList');
            refList.innerHTML = data.topReferrers.map(r => `
                <li class="flow-item">
                    <span class="flow-item-name">${r.source}</span>
                    <span class="flow-item-count">${r.count} sessions</span>
                </li>
            `).join('');

            const pathList = document.getElementById('pathsList');
            pathList.innerHTML = data.navigationPaths.map(p => `
                <li class="flow-item">
                    <span class="flow-item-name">${p.path.replace(/→/g, '<span style="color:#4a5568">→</span>')}</span>
                    <div style="display:flex; align-items:center;">
                        <span style="color:var(--neon-teal); font-weight:600; font-size:11px;">${p.pct}%</span>
                        <span class="flow-item-count" style="margin-left:8px;">${p.count}</span>
                    </div>
                </li>
            `).join('');

            const funnelList = document.getElementById('funnelList');
            if (data.viewFunnel && data.viewFunnel.length > 0) {
                funnelList.innerHTML = data.viewFunnel.slice(0, 5).map(f => `
                    <li class="flow-item">
                        <div class="flow-item-name" style="display:flex; flex-direction:column; gap:4px;">
                            <span>${f.view}</span>
                            <span style="font-size:11px; color:var(--text-dim);">Avg: ${f.avg_display}</span>
                        </div>
                        <div class="flow-item-count" style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                            <span>${f.visits} visits</span>
                            <span style="font-size:11px; color:var(--neon-rose);">${f.exit_pct}% exit</span>
                        </div>
                    </li>
                `).join('');
            } else {
                funnelList.innerHTML = '<li class="flow-item"><span class="flow-item-name" style="color:var(--text-dim)">No dropoff data.</span></li>';
            }
        } else {
            flowGrid.style.display = 'none';
        }
        
        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                backgroundColor: 'rgba(15,21,32,0.9)',
                borderColor: 'rgba(255,255,255,0.1)',
                textStyle: { color: '#f0f6fc' }
            },
            legend: {
                data: ['Traffic (Sessions)', 'Prompts Captured (Friction)', 'Prompts Shipped (Resolved)'],
                textStyle: { color: '#8b949e' },
                bottom: 0
            },
            grid: {
                top: 50, bottom: 60, left: 50, right: 50
            },
            dataZoom: [
                { type: 'slider', show: true, bottom: 25, textStyle: { color: '#8b949e' } },
                { type: 'inside' }
            ],
            xAxis: [
                {
                    type: 'category',
                    data: data.xAxis,
                    axisPointer: { type: 'shadow' },
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                    axisLabel: { color: '#8b949e' }
                }
            ],
            yAxis: [
                {
                    type: 'value',
                    name: interventionId ? 'Bounce Rate %' : 'Prompts',
                    min: 0,
                    max: interventionId ? 100 : null,
                    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                    axisLabel: { color: '#8b949e', formatter: interventionId ? '{value}%' : '{value}' },
                    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
                },
                {
                    type: 'value',
                    name: 'Traffic',
                    min: 0,
                    axisLine: { show: false },
                    axisLabel: { color: '#4a5568' },
                    splitLine: { show: false }
                }
            ],
            series: [
                {
                    name: 'Traffic (Sessions)',
                    type: 'bar',
                    yAxisIndex: 1,
                    data: data.traffic,
                    itemStyle: { color: 'rgba(255,255,255,0.05)', borderRadius: [4,4,0,0] }
                },
                {
                    name: interventionId ? 'Daily Bounce Rate' : 'Prompts Captured (Friction)',
                    type: 'line',
                    smooth: true,
                    data: interventionId ? data.bounceRate : data.captured,
                    itemStyle: { color: interventionId ? '#f43f5e' : '#7b5ea7' },
                    lineStyle: { width: 3 },
                    areaStyle: interventionId ? null : {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(123,94,167,0.3)' },
                            { offset: 1, color: 'rgba(123,94,167,0)' }
                        ])
                    },
                    markPoint: interventionId && data.intervention ? {
                        symbol: 'pin',
                        symbolSize: 60,
                        itemStyle: { color: '#00d4aa' },
                        label: { show: true, formatter: 'Shipped', color: '#fff' },
                        data: [
                            {
                                name: 'Shipped',
                                coord: [data.intervention.resolvedAt, data.bounceRate[data.xAxis.indexOf(data.intervention.resolvedAt)]],
                                tooltip: {
                                    formatter: `<b>Action Shipped</b><br/>${data.intervention.category}: ${data.intervention.prompt}`
                                }
                            }
                        ]
                    } : null
                }
            ]
        };
        
            if (!interventionId) {
                option.series.push({
                    name: 'Prompts Shipped (Resolved)',
                    type: 'line',
                    smooth: true,
                    data: data.shipped,
                    itemStyle: { color: '#00d4aa' },
                    lineStyle: { width: 3 },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(0,212,170,0.3)' },
                            { offset: 1, color: 'rgba(0,212,170,0)' }
                        ])
                    }
                });
            }

            myChart.setOption(option, true);
            
            // Render Scatter Plot
            if (data.sessions && data.sessions.length > 0) {
                const scatterOption = {
                    backgroundColor: 'transparent',
                    tooltip: {
                        trigger: 'item',
                        backgroundColor: 'rgba(15,21,32,0.9)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        textStyle: { color: '#f0f6fc', fontSize: 12 },
                        formatter: function (params) {
                            if (params.componentType === 'markLine') {
                                return '<strong>Deployed:</strong> ' + params.name;
                            }
                            const s = params.data.sessionObj;
                            return '<strong>Session:</strong> ' + s.id.substring(0,8) + '<br/>' +
                                   '<strong>Duration:</strong> ' + s.duration + '<br/>' +
                                   '<strong>Time:</strong> ' + s.start + '<br/>' +
                                   '<strong>Result:</strong> ' + s.classification;
                        }
                    },
                    grid: { top: 10, bottom: 60, left: 50, right: 50 },
                    dataZoom: [
                        { type: 'slider', show: true, bottom: 25, textStyle: { color: '#8b949e' } },
                        { type: 'inside' }
                    ],
                    xAxis: {
                        type: 'time',
                        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                        axisLabel: { color: '#8b949e' }
                    },
                    yAxis: {
                        type: 'value',
                        name: 'Duration (s)',
                        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
                        axisLabel: { color: '#8b949e' },
                        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
                    },
                    series: [{
                        type: 'scatter',
                        symbolSize: 12,
                        data: data.sessions.map(s => {
                            let color = '#8b949e';
                            if (s.classification === 'bounce') color = '#f43f5e';
                            else if (s.classification === 'engaged' || s.classification === 'deep') color = '#00d4aa';
                            return {
                                value: [s.start, s.duration_s],
                                itemStyle: { color: color },
                                name: s.id,
                                sessionObj: s
                            };
                        }),
                        markLine: {
                            symbol: ['none', 'none'],
                            label: { show: false },
                            lineStyle: { type: 'solid', color: '#7b5ea7', width: 2 },
                            data: (data.deployments || []).map(d => ({
                                xAxis: d.date_iso,
                                name: d.message,
                                tooltip: { formatter: d.message }
                            }))
                        }
                    }]
                };
                myScatterChart.setOption(scatterOption);
            } else {
                myScatterChart.clear();
            }

        } catch (err) {
            console.error('Failed to load chart data', err);
            chartDom.innerHTML = '<div style="color:#8b949e;text-align:center;padding-top:100px;">Failed to load data</div>';
        } finally {
            myChart.hideLoading();
            myScatterChart.hideLoading();
        }
    }

    document.addEventListener('DOMContentLoaded', loadChart);
    </script>
</body>
</html>
