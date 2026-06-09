<?php
/**
 * Ripple Session Endpoint  — api/session.php
 * ============================================
 * Accepts POST requests with Ripple session JSON and writes them
 * to the sessions/ directory as sess_*.json files.
 *
 * Called by ripple-tracker.js at flush time (periodic + on unload).
 *
 * Expected POST body (application/json):
 *   {
 *     "sessionId":            "sess_abc123_1780500626530",
 *     "projectKey":           "ripple",
 *     "referrer":             "direct",
 *     "userAgent":            "Mozilla/5.0 ...",
 *     "startTime":            "2026-06-03T15:04:00.000Z",
 *     "views":                [...],
 *     "events":               [...],
 *     "totalDurationSeconds": 42.3
 *   }
 *
 * Response: { "ok": true, "session": "sess_abc123_..." }
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
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$raw = file_get_contents('php://input');
if (!$raw) {
    http_response_code(400);
    echo json_encode(['error' => 'Empty request body']);
    exit;
}

$data = json_decode($raw, true);
if (!is_array($data) || empty($data['sessionId'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON or missing sessionId']);
    exit;
}

// Sanitise the session ID — only safe filename chars
$sessionId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['sessionId']);
if (strlen($sessionId) < 8) {
    http_response_code(400);
    echo json_encode(['error' => 'sessionId too short after sanitisation']);
    exit;
}

// Add server timestamp (matches existing sess_*.json schema)
$data['serverLastActive'] = date('Y-m-d H:i:s');

// Sessions dir: api/ lives one level under project root
$projectRoot = dirname(__DIR__);
$sessionsDir = $projectRoot . DIRECTORY_SEPARATOR . 'sessions';

$configPath = $projectRoot . DIRECTORY_SEPARATOR . 'ripple.config.json';
if (file_exists($configPath)) {
    $config = json_decode(file_get_contents($configPath), true);
    if (isset($data['projectKey']) && isset($config['projects'])) {
        foreach ($config['projects'] as $p) {
            if ($p['key'] === $data['projectKey'] && !empty($p['sessions_dir'])) {
                $sessionsDir = $p['sessions_dir'];
                break;
            }
        }
    }
}

if (!is_dir($sessionsDir)) {
    if (!mkdir($sessionsDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not create sessions directory']);
        exit;
    }
}

$filename = $sessionsDir . DIRECTORY_SEPARATOR . $sessionId . '.json';

// --- GEOGRAPHIC TRACKING ---
if (!isset($data['geo'])) {
    if (file_exists($filename)) {
        $existing = json_decode(file_get_contents($filename), true);
        if (isset($existing['geo'])) {
            $data['geo'] = $existing['geo'];
        }
    }
    
    // If still not set, fetch it
    if (!isset($data['geo'])) {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        // Note: For local testing, ::1 won't return geo data. The API returns status: fail.
        if ($ip && $ip !== '::1' && $ip !== '127.0.0.1') {
            $geoUrl = "http://ip-api.com/json/" . urlencode($ip) . "?fields=status,message,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query";
            
            // Set a short timeout so we don't block the request if the API is down
            $ctx = stream_context_create(['http' => ['timeout' => 2]]);
            $geoRaw = @file_get_contents($geoUrl, false, $ctx);
            if ($geoRaw) {
                $geoDec = json_decode($geoRaw, true);
                if ($geoDec && isset($geoDec['status']) && $geoDec['status'] === 'success') {
                    $data['geo'] = $geoDec;
                }
            }
        } else {
            // Local fallback for testing
            $data['geo'] = [
                'status' => 'success',
                'country' => 'Localhost',
                'regionName' => 'Local',
                'city' => 'Local',
                'lat' => 0,
                'lon' => 0
            ];
        }
    }
}
// ---------------------------

$written  = file_put_contents(
    $filename,
    json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
);

if ($written === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write session file']);
    exit;
}

echo json_encode(['ok' => true, 'session' => $sessionId]);
