<?php
/**
 * Ripple Prompt Capture Gateway — api/capture_prompt.php
 * ========================================================
 * Accepts POST requests from ripple-tracker.js containing UI-targeted prompts.
 * Writes a structured markdown note for AI agent ingestion:
 *   - Directly to local raw inbox (if running on local development workstation)
 *   - Or to project's ./prompts/ queue (if running on remote production server with valid passkey)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Ripple-Auth');

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

// ── Authentication Gate for Remote Production ───────────────────────────────────
$hooksPath = __DIR__ . '/ripple.hooks.php';
if (file_exists($hooksPath)) {
    require_once $hooksPath;
}

$isLocal = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1']) ||
           in_array($_SERVER['SERVER_NAME'] ?? '', ['localhost', '127.0.0.1']);

// If on remote server, require developer passkey verification
if (!$isLocal) {
    $expectedKey = function_exists('ripple_dev_passkey') ? ripple_dev_passkey() : (getenv('RIPPLE_DEV_KEY') ?: null);
    if ($expectedKey) {
        $providedKey = $data['auth_key'] ?? ($_SERVER['HTTP_X_RIPPLE_AUTH'] ?? '');
        if (empty($providedKey) || !hash_equals((string)$expectedKey, (string)$providedKey)) {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => 'Unauthorized: Invalid or missing Ripple developer passkey.']);
            exit;
        }
    }
}

$projectKey      = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['projectKey'] ?? 'default');
$pageUrl         = $data['pageUrl'] ?? '';
$elementSelector = $data['elementSelector'] ?? 'body';
$elementContext  = $data['elementContext'] ?? 'UI Element';
$category        = preg_replace('/[^a-zA-Z0-9_]/', '', $data['category'] ?? 'fix');
$prompt          = trim($data['prompt'] ?? '');
$sessionId       = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['sessionId'] ?? 'sess_unknown');
$timestamp       = $data['timestamp'] ?? date('c');

if (strlen($prompt) < 1) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Prompt is empty']);
    exit;
}

$unixTs   = time();
$promptId = "prompt_{$unixTs}_{$projectKey}";

// ── Build Markdown Content for AI Ingestion ────────────────────────────────────
$mdContent = <<<MARKDOWN
---
type: ripple_prompt
id: {$promptId}
project: {$projectKey}
category: {$category}
status: pending
created: {$timestamp}
session_id: {$sessionId}
url: {$pageUrl}
element_selector: "{$elementSelector}"
element_context: "{$elementContext}"
---

# 🎯 Ripple UI Prompt: [{$category}] {$promptId}

**Target Element:** `{$elementSelector}`  
**Context:** `{$elementContext}`  
**URL:** [{$pageUrl}]({$pageUrl})  
**Timestamp:** {$timestamp}

---

## 📝 User Request / Prompt:
{$prompt}

---

## 🤖 Proposed AI Action Plan:
1. Review the targeted element `{$elementSelector}` on `{$pageUrl}`.
2. Execute requested {$category} update.
3. Verify on localhost and update status in prompt log.
MARKDOWN;

// ── Determine Storage Location ────────────────────────────────────────────────
$projectRoot = dirname(__DIR__);
$remotePromptsDir = $projectRoot . '/prompts';
$vaultRaw = null;

// Check config for local raw inbox path
$configPath = $projectRoot . '/ripple.config.json';
if (file_exists($configPath)) {
    $cfg = json_decode(file_get_contents($configPath), true);
    if (!empty($cfg['vault_path']) && is_dir($cfg['vault_path'] . '/raw')) {
        $vaultRaw = $cfg['vault_path'] . '/raw';
    }
}

if ($vaultRaw && is_dir($vaultRaw)) {
    file_put_contents("{$vaultRaw}/{$promptId}.md", $mdContent);
} else {
    if (!is_dir($remotePromptsDir)) {
        @mkdir($remotePromptsDir, 0755, true);
    }
    @file_put_contents("{$remotePromptsDir}/{$promptId}.md", $mdContent);
}

// Dual write to ripple prompt log if local data directory exists
$rippleLog = $projectRoot . '/data/prompt_log.json';
if (file_exists($rippleLog)) {
    $existing = json_decode(file_get_contents($rippleLog), true) ?: [];
    $existing[] = [
        'promptId'        => $promptId,
        'projectKey'      => $projectKey,
        'category'        => $category,
        'status'          => 'pending',
        'prompt'          => $prompt,
        'elementSelector' => $elementSelector,
        'elementContext'  => $elementContext,
        'pageUrl'         => $pageUrl,
        'sessionId'       => $sessionId,
        'timestamp'       => $timestamp
    ];
    @file_put_contents($rippleLog, json_encode($existing, JSON_PRETTY_PRINT));
}

echo json_encode([
    'ok'       => true,
    'promptId' => $promptId,
    'status'   => 'captured_to_inbox'
]);
