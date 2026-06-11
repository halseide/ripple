<?php
/**
 * Ripple Prompt Update API — api/update_prompt.php
 * ==================================================
 * PATCH endpoint that updates a single record in prompt_log.json by promptId.
 * Used by:
 *   - The agent to write answers (status: answered, answer: "...", answeredAt)
 *   - The dashboard to write user replies and re-categorizations
 *
 * Only provided fields are merged — the rest of the record is untouched.
 *
 * Security: Localhost only (127.0.0.1 / ::1).
 *
 * Expected body (application/json) — all fields optional except promptId:
 *   {
 *     "promptId":      "prompt_1780687819_example",   // required
 *     "status":        "answered",                    // optional
 *     "answer":        "The #last-updated element...", // optional
 *     "answeredAt":    "2026-06-05T19:51:00Z",        // optional
 *     "reply":         "Ok, how do I trigger it?",    // optional
 *     "repliedAt":     "2026-06-05T19:55:00Z",        // optional
 *     "category":      "fix",                         // optional — re-categorize
 *     "commitHash":    "abc1234",                     // optional
 *     "commitMessage": "[Vibe] fix: ...",             // optional
 *     "resolvedAt":    "2026-06-05T20:00:00Z"         // optional
 *   }
 *
 * Response:
 *   { "ok": true, "promptId": "..." }
 *   { "ok": false, "error": "..." }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, PATCH, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ── Localhost-only guard ──────────────────────────────────────────────────────
$remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($remoteAddr, ['127.0.0.1', '::1', 'localhost'], true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Prompt update API is restricted to localhost only.']);
    exit;
}

if (!in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PATCH'], true)) {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed. Use POST or PATCH.']);
    exit;
}

// ── Parse body ────────────────────────────────────────────────────────────────
$raw = file_get_contents('php://input');
if (!$raw) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Empty request body.']);
    exit;
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON in request body.']);
    exit;
}

if (empty($data['promptId'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing required field: promptId.']);
    exit;
}

$promptId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['promptId']);

// ── Allowlisted updatable fields ──────────────────────────────────────────────
$allowedFields = [
    'status', 'answer', 'answeredAt',
    'reply', 'repliedAt',
    'category', 'subtype',
    'commitHash', 'commitMessage', 'resolvedAt',
];

// ── Load prompt_log.json ──────────────────────────────────────────────────────
$logFile = __DIR__ . '/../data/prompt_log.json';
if (!file_exists($logFile)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'prompt_log.json not found.']);
    exit;
}

$logData = json_decode(file_get_contents($logFile), true);
if (!is_array($logData)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'prompt_log.json is corrupt or unreadable.']);
    exit;
}

// ── Find and update the record ────────────────────────────────────────────────
$found = false;
foreach ($logData as &$record) {
    if (($record['promptId'] ?? '') === $promptId) {
        $targetRecord = null;
        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $record[$field] = $data[$field];
            }
        }
        $targetRecord = $record;
        $found = true;
        break;
    }
}
unset($record);

if ($found) {
    $status = $targetRecord['status'] ?? '';
    $configPath = realpath(__DIR__ . '/../ripple.config.json');
    if ($configPath && file_exists($configPath)) {
        $config = json_decode(file_get_contents($configPath), true) ?: [];
        if (!empty($config['vault_path']) && $config['vault_path'] !== '[VAULT_PATH]') {
            $rawInbox = rtrim($config['vault_path'], '\\/') . DIRECTORY_SEPARATOR . 'raw';
            if (is_dir($rawInbox)) {
                $pId = $targetRecord['promptId'];
                $mdFile = $rawInbox . DIRECTORY_SEPARATOR . $pId . '.md';

                if ($status === 'dismissed' || $status === 'shipped') {
                    $archiveDir = $rawInbox . DIRECTORY_SEPARATOR . 'Archive';
                    if (!is_dir($archiveDir)) {
                        mkdir($archiveDir, 0777, true);
                    }
                    $archiveFile = $archiveDir . DIRECTORY_SEPARATOR . $pId . '.md';
                    if (file_exists($mdFile)) {
                        $content = file_get_contents($mdFile);
                        $content = preg_replace('/^status:\s*(pending|answered|canceled|shipped|dismissed)\s*$/m', 'status: ' . $status, $content);
                        file_put_contents($mdFile, $content);
                        rename($mdFile, $archiveFile);
                    }
                } elseif ($status === 'pending' || $status === 'canceled') {
                    if ($status === 'canceled') {
                        if (file_exists($mdFile)) {
                            $content = file_get_contents($mdFile);
                            $content = preg_replace('/^status:\s*pending\s*$/m', 'status: canceled', $content);
                            file_put_contents($mdFile, $content);
                        }
                    } else {
                        $pKey      = $targetRecord['projectKey'] ?? 'unknown';
                        $pCat      = $targetRecord['category'] ?? 'question';
                        $pUrl      = htmlspecialchars($targetRecord['pageUrl'] ?? '', ENT_QUOTES, 'UTF-8');
                        $pSel      = htmlspecialchars($targetRecord['elementSelector'] ?? '', ENT_QUOTES, 'UTF-8');
                        $pCtx      = htmlspecialchars($targetRecord['elementContext'] ?? '', ENT_QUOTES, 'UTF-8');
                        $pSess     = $targetRecord['sessionId'] ?? 'unknown';
                        $pTime     = $targetRecord['capturedAt'] ?? date('c');
                        $pPrompt   = $targetRecord['prompt'] ?? '';
                        $pDateFmt  = date('Y-m-d H:i', strtotime($pTime));
                        
                        $replySec  = '';
                        if (!empty($targetRecord['reply'])) {
                            $replySec = "\n## User Reply / Follow-up\n\n" . $targetRecord['reply'] . "\n";
                        }

                        $markdown = <<<MD
---
prompt_id: {$pId}
project_key: {$pKey}
category: {$pCat}
page_url: {$pUrl}
element_selector: "{$pSel}"
element_context: "{$pCtx}"
session_id: {$pSess}
captured_at: {$pTime}
status: pending
---

# 🎯 Ripple UI Capture — {$pId}

**Captured:** {$pDateFmt}
**Project:** `{$pKey}`
**Category:** `{$pCat}`
**Page:** `{$pUrl}`

## Element Context

**Target:** `{$pCtx}`
**Selector Path:** `{$pSel}`

## Prompt

{$pPrompt}
{$replySec}
---

> [!NOTE] AI Processing Instructions
> The element selector path above pinpoints the exact DOM node the user Shift+Left-Clicked.
> Map `{$pUrl}` to the physical file in the `{$pKey}` repository (see `ripple.config.json` for the `git_repo` path),
> then search the file for the selector's tag/class/ID to locate the relevant lines of code.
> Commit message format: `[Vibe] {$pCat}: <description>\\n- Resolves Prompt: {$pId}`

MD;
                        file_put_contents($mdFile, $markdown);
                    }
                }
            }
        }
    }
}
unset($record);

if (!$found) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => "promptId \"$promptId\" not found in prompt_log.json."]);
    exit;
}

// ── Write back ────────────────────────────────────────────────────────────────
$written = file_put_contents(
    $logFile,
    json_encode($logData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
);

if ($written === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to write prompt_log.json. Check file permissions.']);
    exit;
}

echo json_encode(['ok' => true, 'promptId' => $promptId]);
