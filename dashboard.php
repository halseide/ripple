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
header('Location: /ripple/src/dashboard/?project=' . urlencode($projectKey) . '&cb=' . time());
exit;
