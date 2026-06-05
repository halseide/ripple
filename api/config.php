<?php
/**
 * Ripple Config API — api/config.php
 * ====================================
 * Provides read/write access to ripple.config.json for the dashboard Settings panel.
 *
 * GET  → Returns the full parsed config as JSON
 * POST → Accepts an updated config object, validates it, writes it to disk
 *
 * Security: Only accepts requests from localhost.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ── Localhost-only guard ──────────────────────────────────────────────────────
$remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '';
$allowedAddresses = ['127.0.0.1', '::1', 'localhost'];
if (!in_array($remoteAddr, $allowedAddresses, true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'Config API is restricted to localhost only.']);
    exit;
}

// ── Locate config file ────────────────────────────────────────────────────────
// api/config.php lives in /api/, config is in project root
$configPath = realpath(__DIR__ . '/../ripple.config.json');

if (!$configPath || !file_exists($configPath)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'ripple.config.json not found.']);
    exit;
}

// ── GET: Return current config ────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $raw = file_get_contents($configPath);
    $config = json_decode($raw, true);

    if (!is_array($config)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Failed to parse ripple.config.json — invalid JSON on disk.']);
        exit;
    }

    // Ensure every project has a github_url field (backfill for old configs)
    if (isset($config['projects']) && is_array($config['projects'])) {
        foreach ($config['projects'] as &$project) {
            if (!array_key_exists('github_url', $project)) {
                $project['github_url'] = '';
            }
        }
        unset($project);
    }

    echo json_encode(['ok' => true, 'config' => $config]);
    exit;
}

// ── POST: Write updated config ────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    if (!$raw) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Empty request body.']);
        exit;
    }

    $incoming = json_decode($raw, true);
    if (!is_array($incoming)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Invalid JSON in request body.']);
        exit;
    }

    // ── Validate required top-level structure ─────────────────────────────────
    if (!isset($incoming['projects']) || !is_array($incoming['projects'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Config must contain a "projects" array.']);
        exit;
    }

    foreach ($incoming['projects'] as $i => $project) {
        $requiredFields = ['key', 'name', 'url', 'sessions_dir', 'git_repo'];
        foreach ($requiredFields as $field) {
            if (empty($project[$field])) {
                http_response_code(400);
                echo json_encode(['ok' => false, 'error' => "Project at index $i is missing required field: \"$field\"."]);
                exit;
            }
        }

        // Sanitise key — alphanumeric + dash/underscore only
        if (!preg_match('/^[a-zA-Z0-9_\-]+$/', $project['key'])) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => "Project key \"{$project['key']}\" contains invalid characters."]);
            exit;
        }

        // github_url must be empty or a valid https:// URL
        $githubUrl = $project['github_url'] ?? '';
        if ($githubUrl !== '' && !filter_var($githubUrl, FILTER_VALIDATE_URL)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => "github_url for project \"{$project['key']}\" is not a valid URL."]);
            exit;
        }
    }

    // ── Backup existing config before write ────────────────────────────────────
    $backupPath = $configPath . '.bak';
    copy($configPath, $backupPath);

    // ── Preserve _comment field from original config ───────────────────────────
    $existingRaw = file_get_contents($configPath);
    $existing = json_decode($existingRaw, true);
    if (isset($existing['_comment']) && !isset($incoming['_comment'])) {
        $incoming['_comment'] = $existing['_comment'];
    }

    // ── Preserve version field ────────────────────────────────────────────────
    if (isset($existing['version']) && !isset($incoming['version'])) {
        $incoming['version'] = $existing['version'];
    }

    // ── Write to disk ─────────────────────────────────────────────────────────
    $written = file_put_contents(
        $configPath,
        json_encode($incoming, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );

    if ($written === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Failed to write config to disk. Check file permissions.']);
        exit;
    }

    echo json_encode([
        'ok'      => true,
        'message' => 'Config saved successfully.',
        'backup'  => basename($backupPath),
    ]);
    exit;
}

// ── Unsupported method ────────────────────────────────────────────────────────
http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed.']);
