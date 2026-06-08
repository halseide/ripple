<?php
/**
 * Ripple Prompt Capture Gateway  — api/capture_prompt.php
 * =========================================================
 * Accepts POST requests from ripple-tracker.js containing a
 * UI-targeted developer prompt, then:
 *   1. Writes a structured markdown file to [VAULT_PATH]\raw\ for AI ingestion.
 *   2. Dual-writes a lifecycle record to [WEB_ROOT]\ripple\data\prompt_log.json
 *      for the Ripple dashboard to track status (pending → shipped) + commit links.
 *
 * Expected POST body (application/json):
 *   {
 *     "projectKey":      "project-alpha",
 *     "pageUrl":         "http://localhost/project-alpha/",
 *     "elementSelector": "body > div.header > span#clock",
 *     "elementContext":  "span#clock • clock-label",
 *     "category":        "fix",
 *     "prompt":          "Remove the birthday text from the clock header.",
 *     "sessionId":       "sess_abc123_...",
 *     "timestamp":       "2026-06-04T20:00:00.000Z"
 *   }
 *
 * Response:
 *   { "ok": true, "promptId": "prompt_1780529810_project-alpha" }
 *   { "ok": false, "error": "..." }
 *
 * Prompt ID format: prompt_{unix_timestamp}_{projectKey}
 * Atlas file:       [VAULT_PATH]\raw\{promptId}.md
 * Ripple log:       [WEB_ROOT]\ripple\data\prompt_log.json
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

$raw = file_get_contents('php://input');
if (!$raw) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Empty request body']);
    exit;
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON']);
    exit;
}

// ── Validate required fields ──────────────────────────────────────────────────
$required = ['projectKey', 'pageUrl', 'elementSelector', 'elementContext', 'category', 'prompt'];
foreach ($required as $field) {
    if (empty($data[$field])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => "Missing required field: $field"]);
        exit;
    }
}

$prompt = trim($data['prompt']);
if (strlen($prompt) < 3) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Prompt too short']);
    exit;
}

// ── Sanitise inputs ───────────────────────────────────────────────────────────
$projectKey      = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['projectKey']);
$pageUrl         = $data['pageUrl'];   // keep raw for JSON storage
$elementSelector = $data['elementSelector'];
$elementContext  = $data['elementContext'];
$category        = preg_replace('/[^a-zA-Z0-9_]/', '', $data['category']);
$sessionId       = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['sessionId'] ?? 'unknown');
$timestamp       = $data['timestamp'] ?? date('c');

// ── Generate Prompt ID ────────────────────────────────────────────────────────
$unixTs   = time();
$promptId = "prompt_{$unixTs}_{$projectKey}";

// ── Load Configuration ────────────────────────────────────────────────────────
$configPath = realpath(__DIR__ . '/../ripple.config.json');
$config = [];
if ($configPath && file_exists($configPath)) {
    $configRaw = file_get_contents($configPath);
    if ($configRaw) {
        $config = json_decode($configRaw, true) ?: [];
    }
}

// ── Vault raw inbox path ───────────────────────────────────────────────────
$vaultPath = $config['vault_path'] ?? '[VAULT_PATH]';
if ($vaultPath === '[VAULT_PATH]') {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Please set "vault_path" in ripple.config.json']);
    exit;
}

$rawInbox = rtrim($vaultPath, '\\/') . DIRECTORY_SEPARATOR . 'raw';
if (!is_dir($rawInbox)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Vault raw inbox directory not found at: ' . $rawInbox]);
    exit;
}

// ── Build markdown file (htmlspecialchars for display safety) ─────────────────
$dateFormatted = date('Y-m-d H:i');
$pageUrlEsc    = htmlspecialchars($pageUrl,         ENT_QUOTES, 'UTF-8');
$selectorEsc   = htmlspecialchars($elementSelector, ENT_QUOTES, 'UTF-8');
$contextEsc    = htmlspecialchars($elementContext,  ENT_QUOTES, 'UTF-8');

$markdown = <<<MD
---
prompt_id: {$promptId}
project_key: {$projectKey}
category: {$category}
page_url: {$pageUrlEsc}
element_selector: "{$selectorEsc}"
element_context: "{$contextEsc}"
session_id: {$sessionId}
captured_at: {$timestamp}
status: pending
---

# 🎯 Ripple UI Capture — {$promptId}

**Captured:** {$dateFormatted}
**Project:** `{$projectKey}`
**Category:** `{$category}`
**Page:** `{$pageUrlEsc}`

## Element Context

**Target:** `{$contextEsc}`
**Selector Path:** `{$selectorEsc}`

## Prompt

{$prompt}

---

> [!NOTE] AI Processing Instructions
> The element selector path above pinpoints the exact DOM node the user Shift+Right-Clicked.
> Map `{$pageUrlEsc}` to the physical file in the `{$projectKey}` repository (see `ripple.config.json` for the `git_repo` path),
> then search the file for the selector's tag/class/ID to locate the relevant lines of code.
> Commit message format: `[Vibe] {$category}: <description>\n- Resolves Prompt: {$promptId}`

MD;

// ── Write Atlas raw inbox markdown ────────────────────────────────────────────
$filename = $rawInbox . DIRECTORY_SEPARATOR . $promptId . '.md';
$written  = file_put_contents($filename, $markdown);

if ($written === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to write prompt file to raw inbox']);
    exit;
}

// ── Dual-write to prompt_log.json ────────────────────────────────────────────
$logFile = __DIR__ . '/../data/prompt_log.json';
$logData = [];
if (file_exists($logFile)) {
    $existing = json_decode(file_get_contents($logFile), true);
    if (is_array($existing)) $logData = $existing;
}

// Prepend the new prompt record
array_unshift($logData, [
    'promptId'        => $promptId,
    'projectKey'      => $projectKey,
    'pageUrl'         => $pageUrl,
    'elementSelector' => $elementSelector,
    'elementContext'  => $elementContext,
    'category'        => $category,
    'prompt'          => $prompt,
    'sessionId'       => $sessionId,
    'status'          => 'pending',
    'capturedAt'      => $timestamp,
    'x'               => $data['captureX'] ?? 100,
    'y'               => $data['captureY'] ?? 100,
    'resolvedAt'      => null,
    'commitHash'      => null,
    'commitMessage'   => null
]);

file_put_contents($logFile, json_encode($logData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

// ── Success ───────────────────────────────────────────────────────────────────
echo json_encode([
    'ok'       => true,
    'promptId' => $promptId,
    'file'     => "raw/{$promptId}.md",
]);
