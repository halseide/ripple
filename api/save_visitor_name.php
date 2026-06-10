<?php
/**
 * Ripple - Save Visitor Name API
 * 
 * Saves a manual label/name for a hashed visitorId into `data/visitor_names.json`.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

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
$data = json_decode($raw, true);

if (!isset($data['visitorId']) || !isset($data['name'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing visitorId or name']);
    exit;
}

$visitorId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $data['visitorId']);
$name = trim(htmlspecialchars($data['name'], ENT_QUOTES, 'UTF-8'));

$namesFile = __DIR__ . '/../data/visitor_names.json';
$namesData = [];

if (file_exists($namesFile)) {
    $existing = json_decode(file_get_contents($namesFile), true);
    if (is_array($existing)) {
        $namesData = $existing;
    }
}

if ($name === '') {
    unset($namesData[$visitorId]);
} else {
    $namesData[$visitorId] = $name;
}

$written = file_put_contents($namesFile, json_encode($namesData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

if ($written === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to write to visitor_names.json']);
    exit;
}

echo json_encode(['ok' => true, 'visitorId' => $visitorId, 'name' => $name]);
