<?php
/**
 * Ripple — api/analyze.php
 * =========================
 * Runs scripts/analyze.py directly on the server to recompile analytics data.
 * Called by the frontend dashboard refresh button.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$projectRoot = dirname(__DIR__);
$scriptPath = $projectRoot . DIRECTORY_SEPARATOR . 'scripts' . DIRECTORY_SEPARATOR . 'analyze.py';

if (!file_exists($scriptPath)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'analyze.py not found at ' . $scriptPath]);
    exit;
}

$started_at = microtime(true);

// Run the script and capture both stdout and stderr
// Resolve absolute path to python if possible to avoid Apache path environment constraints
$pythonCmd = 'python';
$userPath = 'C:\\Users\\halse\\AppData\\Local\\Programs\\Python\\Python314\\python.exe';
if (file_exists($userPath)) {
    $pythonCmd = $userPath;
}

$cmd = escapeshellarg($pythonCmd) . ' ' . escapeshellarg($scriptPath) . ' 2>&1';
$output = [];
$exit_code = 0;

// Execute the command in the context of the project root
$oldCwd = getcwd();
chdir($projectRoot);
exec($cmd, $output, $exit_code);
chdir($oldCwd);

$elapsed_ms = round((microtime(true) - $started_at) * 1000);
$output_str = implode("\n", $output);

echo json_encode([
    'success'       => $exit_code === 0,
    'exit_code'     => $exit_code,
    'elapsed_ms'    => $elapsed_ms,
    'script_output' => $output_str
]);
