<?php
/**
 * Ripple Session Endpoint — api/session.php — v0.13.0
 * =====================================================
 * Accepts POST requests with Ripple session JSON and writes them to disk.
 * Called by ripple-tracker.js at flush time (periodic + on unload).
 *
 * HARDENED BY DEFAULT (v0.13.0) — copy this file into any project as-is:
 *   - 512 KB body cap (anonymous write endpoint)
 *   - no CORS wildcard (tracker posts same-origin; cross-origin is opt-in)
 *   - secret-bearing query params scrubbed from EVERY string in the payload
 *     (t, token, key, auth, secret, password, apikey, api_key, sig, signature)
 *   - external geo lookup (ip-api.com) is OPT-IN, not default — no visitor
 *     IPs leave your server unless you ask for it
 *   - identity passthrough: sanitized {name,id,admin} from Ripple.identify()
 *
 * OPTIONAL HOOKS — drop a `ripple.hooks.php` next to this file (or in the
 * project root) to adapt per app. Presence of ripple_valid_keys() switches
 * on MULTI-TENANT mode: keys are validated and sessions are written to
 * ripple/{key}/sessions/ so each tenant is its own Ripple project
 * (config: ftp_remote_dir = /app/ripple/{key} — analyze.py appends /sessions).
 *
 *   function ripple_valid_keys(): array   // active tenant keys; activates tenant mode
 *   function ripple_scrub_params(): array // EXTRA secret param names to scrub
 *   function ripple_allow_geo(): bool     // true = legacy ip-api.com lookup
 *   function ripple_allow_cors(): bool    // true = legacy Access-Control-Allow-Origin: *
 *   function ripple_max_bytes(): int      // override the 512 KB cap
 *
 * Without hooks, behavior matches legacy single-project installs: any sane
 * key is accepted and sessions land in {projectRoot}/sessions/ (honoring a
 * local ripple.config.json sessions_dir override for localhost dev).
 */

$projectRoot = dirname(__DIR__);

// ── Load optional hooks ─────────────────────────────────────────────────────
foreach ([__DIR__ . '/ripple.hooks.php', $projectRoot . '/ripple.hooks.php'] as $hf) {
    if (is_file($hf)) { require_once $hf; break; }
}
$H = function (string $fn, $default) {
    return function_exists($fn) ? $fn() : $default;
};

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
if ($H('ripple_allow_cors', false)) {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── Size cap ────────────────────────────────────────────────────────────────
$maxBytes = (int)$H('ripple_max_bytes', 524288);
$raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
if ($raw === false || strlen($raw) === 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Empty body']);
    exit;
}
if (strlen($raw) > $maxBytes) {
    http_response_code(413);
    echo json_encode(['error' => 'Payload too large']);
    exit;
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

// ── projectKey ──────────────────────────────────────────────────────────────
$key = strtolower(trim((string)($data['projectKey'] ?? '')));
if (!preg_match('/^[a-z0-9_-]{1,32}$/', $key)) {
    http_response_code(400);
    echo json_encode(['error' => 'Bad projectKey']);
    exit;
}
$tenantKeys = $H('ripple_valid_keys', null);   // non-null array = multi-tenant mode
if (is_array($tenantKeys) && !in_array($key, array_map('strtolower', $tenantKeys), true)) {
    http_response_code(403);
    echo json_encode(['error' => 'Unknown project']);
    exit;
}

// ── sessionId sanitation (sess_*.json naming contract) ─────────────────────
$sessionId = (string)($data['sessionId'] ?? '');
$sessionId = preg_replace('/[^A-Za-z0-9_\-]/', '', $sessionId) ?? '';
if (strpos($sessionId, 'sess_') !== 0) { $sessionId = 'sess_' . $sessionId; }
if (strlen($sessionId) < 10 || strlen($sessionId) > 80) {
    http_response_code(400);
    echo json_encode(['error' => 'sessionId too short after sanitisation']);
    exit;
}

// ── Secret scrub — every string, recursively ────────────────────────────────
$scrubParams = array_merge(
    ['t', 'token', 'key', 'auth', 'secret', 'password', 'apikey', 'api_key', 'sig', 'signature'],
    (array)$H('ripple_scrub_params', [])
);
$scrubRe = '/([?&](?:' . implode('|', array_map('preg_quote', $scrubParams)) . ')=)[^&#\s"\']+/i';
$scrub = function ($v) use (&$scrub, $scrubRe) {
    if (is_string($v)) return preg_replace($scrubRe, '$1[REDACTED]', $v);
    if (is_array($v)) { $o = []; foreach ($v as $k => $x) $o[$k] = $scrub($x); return $o; }
    return $v;
};
$data = $scrub($data);

// ── Identity passthrough (Ripple.identify) — sanitized shape only ──────────
if (isset($data['identity']) && is_array($data['identity']) && !empty($data['identity']['name'])) {
    $data['identity'] = [
        'name'  => mb_substr((string)$data['identity']['name'], 0, 80),
        'id'    => isset($data['identity']['id']) ? mb_substr((string)$data['identity']['id'], 0, 64) : null,
        'admin' => !empty($data['identity']['admin']),
    ];
} else {
    unset($data['identity']);
}

$data['projectKey']       = $key;
$data['serverLastActive'] = date('Y-m-d H:i:s');

// ── Resolve sessions dir ────────────────────────────────────────────────────
if (is_array($tenantKeys)) {
    // Multi-tenant: ripple/{key}/sessions — one Ripple project per tenant.
    $sessionsDir = $projectRoot . DIRECTORY_SEPARATOR . 'ripple'
                 . DIRECTORY_SEPARATOR . $key . DIRECTORY_SEPARATOR . 'sessions';
} else {
    // Legacy single-project: {projectRoot}/sessions, with local dev override.
    $sessionsDir = $projectRoot . DIRECTORY_SEPARATOR . 'sessions';
    $configPath  = $projectRoot . DIRECTORY_SEPARATOR . 'ripple.config.json';
    if (file_exists($configPath)) {
        $config = json_decode((string)file_get_contents($configPath), true);
        foreach (($config['projects'] ?? []) as $p) {
            if (($p['key'] ?? null) === $key && !empty($p['sessions_dir'])) {
                $sessionsDir = $p['sessions_dir'];
                break;
            }
        }
    }
}
if (!is_dir($sessionsDir) && !mkdir($sessionsDir, 0755, true)) {
    http_response_code(500);
    echo json_encode(['error' => 'Could not create sessions directory']);
    exit;
}

$filename = $sessionsDir . DIRECTORY_SEPARATOR . $sessionId . '.json';

// ── Optional geo (LEGACY, opt-in via hooks) ─────────────────────────────────
if ($H('ripple_allow_geo', false) && !isset($data['geo'])) {
    if (file_exists($filename)) {
        $existing = json_decode((string)file_get_contents($filename), true);
        if (isset($existing['geo'])) $data['geo'] = $existing['geo'];
    }
    if (!isset($data['geo'])) {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        if ($ip && $ip !== '::1' && $ip !== '127.0.0.1') {
            $geoUrl = "http://ip-api.com/json/" . urlencode($ip)
                    . "?fields=status,message,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query";
            $ctx = stream_context_create(['http' => ['timeout' => 2]]);
            $geoRaw = @file_get_contents($geoUrl, false, $ctx);
            if ($geoRaw) {
                $geoDec = json_decode($geoRaw, true);
                if (($geoDec['status'] ?? '') === 'success') $data['geo'] = $geoDec;
            }
        } else {
            $data['geo'] = ['status' => 'success', 'country' => 'Localhost',
                            'regionName' => 'Local', 'city' => 'Local', 'lat' => 0, 'lon' => 0];
        }
    }
}

// ── Write ───────────────────────────────────────────────────────────────────
$written = file_put_contents(
    $filename,
    json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
);
if ($written === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Write failed']);
    exit;
}

echo json_encode(['ok' => true, 'session' => $sessionId]);
