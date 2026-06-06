<?php
header('Content-Type: application/json');

$promptLogFile = '../data/prompt_log.json';
$analyticsFile = '../data/project_analytics.json';

// Initialize data structures
$dailyCaptured = [];
$dailyShipped = [];
$dailyTraffic = [];
$dailyBounces = [];
$availableInterventions = [];
$topReferrers = [];
$navigationPaths = [];
$viewFunnel = [];
$allSessions = [];
$allDeployments = [];

$projectFilter = isset($_GET['project']) && $_GET['project'] !== '' ? $_GET['project'] : null;
$interventionFilter = isset($_GET['intervention']) && $_GET['intervention'] !== '' ? $_GET['intervention'] : null;

$interventionEvent = null;

// Parse Prompt Log
if (file_exists($promptLogFile)) {
    $prompts = json_decode(file_get_contents($promptLogFile), true);
    if (is_array($prompts)) {
        foreach ($prompts as $p) {
            $pk = $p['projectKey'] ?? $p['project_key'] ?? null;
            if ($projectFilter && $pk !== $projectFilter) {
                continue;
            }
            
            // If we are looking for a specific intervention, ignore all other prompts
            if ($interventionFilter) {
                if ($p['promptId'] === $interventionFilter) {
                    $interventionEvent = [
                        'promptId' => $p['promptId'],
                        'capturedAt' => !empty($p['capturedAt']) ? substr($p['capturedAt'], 0, 10) . ' ' . substr($p['capturedAt'], 11, 5) : null,
                        'resolvedAt' => !empty($p['resolvedAt']) ? substr($p['resolvedAt'], 0, 10) . ' ' . substr($p['resolvedAt'], 11, 5) : null,
                        'prompt' => $p['prompt'],
                        'category' => $p['category']
                    ];
                } else {
                    continue;
                }
            }

            if (!empty($p['capturedAt'])) {
                // Extracts "YYYY-MM-DD HH:MM" from "YYYY-MM-DDTHH:MM:SS"
                $date = substr($p['capturedAt'], 0, 10) . ' ' . substr($p['capturedAt'], 11, 5);
                if (!isset($dailyCaptured[$date])) $dailyCaptured[$date] = 0;
                $dailyCaptured[$date]++;
            }
            if ($p['status'] === 'shipped' && !empty($p['resolvedAt'])) {
                // Extracts "YYYY-MM-DD HH:MM" from "YYYY-MM-DDTHH:MM:SS"
                $date = substr($p['resolvedAt'], 0, 10) . ' ' . substr($p['resolvedAt'], 11, 5);
                if (!isset($dailyShipped[$date])) $dailyShipped[$date] = 0;
                $dailyShipped[$date]++;
                
                // If filtering by project but no specific intervention is selected, return available ones
                if ($projectFilter && !$interventionFilter) {
                    $availableInterventions[] = [
                        'id' => $p['promptId'],
                        'text' => substr($p['prompt'], 0, 50) . '...'
                    ];
                }
            }
        }
    }
}

// Parse Analytics for Traffic and Behavior
if (file_exists($analyticsFile)) {
    $analytics = json_decode(file_get_contents($analyticsFile), true);
    if (isset($analytics['projects']) && is_array($analytics['projects'])) {
        foreach ($analytics['projects'] as $project) {
            if ($projectFilter && (!isset($project['project_key']) || $project['project_key'] !== $projectFilter)) {
                continue;
            }
            // Traffic
            if (isset($project['daily_trend']) && is_array($project['daily_trend'])) {
                foreach ($project['daily_trend'] as $date => $count) {
                    if (!isset($dailyTraffic[$date])) $dailyTraffic[$date] = 0;
                    $dailyTraffic[$date] += $count;
                }
            }
            // Bounces
            if (isset($project['daily_bounces']) && is_array($project['daily_bounces'])) {
                foreach ($project['daily_bounces'] as $date => $count) {
                    if (!isset($dailyBounces[$date])) $dailyBounces[$date] = 0;
                    $dailyBounces[$date] += $count;
                }
            }
            // Referrers
            if (isset($project['top_referrers']) && is_array($project['top_referrers'])) {
                // If filtering by project, just take the project's referrers directly
                if ($projectFilter) {
                    $topReferrers = $project['top_referrers'];
                }
            }
            // Navigation Paths
            if (isset($project['navigation_paths']) && is_array($project['navigation_paths'])) {
                if ($projectFilter) {
                    $navigationPaths = array_slice($project['navigation_paths'], 0, 5); // Take top 5
                }
            }
            // View Funnel
            if (isset($project['view_funnel']) && is_array($project['view_funnel'])) {
                if ($projectFilter) {
                    $viewFunnel = $project['view_funnel'];
                }
            }
            // Sessions
            if (isset($project['sessions']) && is_array($project['sessions'])) {
                if ($projectFilter) {
                    $allSessions = $project['sessions'];
                } else {
                    $allSessions = array_merge($allSessions, $project['sessions']);
                }
            }
            // Deployments
            if (isset($project['deployments']) && is_array($project['deployments'])) {
                if ($projectFilter) {
                    $allDeployments = $project['deployments'];
                } else {
                    $allDeployments = array_merge($allDeployments, $project['deployments']);
                }
            }
        }
    }
}

// Consolidate dates
$allDates = array_unique(array_merge(
    array_keys($dailyCaptured),
    array_keys($dailyShipped),
    array_keys($dailyTraffic),
    array_keys($dailyBounces)
));

// Sort dates
usort($allDates, function($a, $b) {
    return strtotime($a) - strtotime($b);
});

// Build final dataset
$xAxis = [];
$seriesCaptured = [];
$seriesShipped = [];
$seriesTraffic = [];
$seriesBounceRate = [];

foreach ($allDates as $date) {
    $xAxis[] = $date;
    $seriesCaptured[] = isset($dailyCaptured[$date]) ? $dailyCaptured[$date] : 0;
    $seriesShipped[] = isset($dailyShipped[$date]) ? $dailyShipped[$date] : 0;
    
    $traffic = isset($dailyTraffic[$date]) ? $dailyTraffic[$date] : 0;
    $bounces = isset($dailyBounces[$date]) ? $dailyBounces[$date] : 0;
    
    $seriesTraffic[] = $traffic;
    $seriesBounceRate[] = ($traffic > 0) ? round(($bounces / $traffic) * 100, 1) : 0;
}

echo json_encode([
    'ok' => true,
    'xAxis' => $xAxis,
    'captured' => $seriesCaptured,
    'shipped' => $seriesShipped,
    'traffic' => $seriesTraffic,
    'bounceRate' => $seriesBounceRate,
    'intervention' => $interventionEvent,
    'availableInterventions' => array_reverse($availableInterventions),
    'topReferrers' => $topReferrers,
    'navigationPaths' => $navigationPaths,
    'viewFunnel' => $viewFunnel,
    'sessions' => $allSessions,
    'deployments' => $allDeployments
]);
?>
