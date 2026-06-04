<?php
/**
 * Ripple Prompt Capture Gateway  — api/capture_prompt.php
 * =========================================================
 * Accepts POST requests from ripple-tracker.js containing a
 * UI-targeted developer prompt, then writes a structured markdown
 * file to [VAULT_PATH]\raw\ for AI ingestion on the next boot.
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
 * File written to: [VAULT_PATH]\raw\{promptId}.md
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
$pageUrl         = htmlspecialchars($data['pageUrl'], ENT_QUOTES, 'UTF-8');
$elementSelector = htmlspecialchars($data['elementSelector'], ENT_QUOTES, 'UTF-8');
$elementContext  = htmlspecialchars($data['elementContext'], ENT_QUOTES, 'UTF-8');
$category        = preg_replace('/[^a-zA-Z0-9_]/', '', $data['category']);
$sessionId       = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['sessionId'] ?? 'unknown');
$timestamp       = $data['timestamp'] ?? date('c');

// ── Generate Prompt ID ────────────────────────────────────────────────────────
$unixTs   = time();
$promptId = "prompt_{$unixTs}_{$projectKey}";

// ── Atlas2.0 raw inbox path ───────────────────────────────────────────────────
$rawInbox = '[VAULT_PATH]\\raw';
if (!is_dir($rawInbox)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Atlas2.0 raw inbox directory not found']);
    exit;
}

// ── Build markdown file ───────────────────────────────────────────────────────
$dateFormatted = date('Y-m-d H:i');
$promptEscaped = str_replace(['`', '\\'], ['\\`', '\\\\'], $prompt);

$markdown = <<<MD
---
prompt_id: {$promptId}
project_key: {$projectKey}
category: {$category}
page_url: {$pageUrl}
element_selector: "{$elementSelector}"
element_context: "{$elementContext}"
session_id: {$sessionId}
captured_at: {$timestamp}
status: pending
---

# 🎯 Ripple UI Capture — {$promptId}

**Captured:** {$dateFormatted}
**Project:** `{$projectKey}`
**Category:** `{$category}`
**Page:** `{$pageUrl}`

## Element Context

**Target:** `{$elementContext}`
**Selector Path:** `{$elementSelector}`

## Prompt

{$prompt}

---

> [!NOTE] AI Processing Instructions
> The element selector path above pinpoints the exact DOM node the user was inspecting when this prompt was captured.
> Map `{$pageUrl}` to the physical file in the `{$projectKey}` repository (see `ripple.config.json` for the `git_repo` path),
> then search the file for the selector's tag/class/ID to locate the relevant lines of code.
> Commit message format: `[Vibe] {$category}: <description>\n- Resolves Prompt: {$promptId}`

MD;

// ── Write file ────────────────────────────────────────────────────────────────
$filename = $rawInbox . DIRECTORY_SEPARATOR . $promptId . '.md';
$written  = file_put_contents($filename, $markdown);

if ($written === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to write prompt file to raw inbox']);
    exit;
}

// ── Success ───────────────────────────────────────────────────────────────────
echo json_encode([
    'ok'       => true,
    'promptId' => $promptId,
    'file'     => "raw/{$promptId}.md",
]);
