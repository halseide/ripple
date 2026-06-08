const fs = require('fs');
let code = fs.readFileSync('src/tracker/ripple-tracker.js', 'utf8');

// 1. Replace _breadcrumbs with _blobs, _spawnBreadcrumb with _spawnBlob
code = code.replace(/const _breadcrumbs = \[\];/g, 'const _blobs = [];\n    let _pendingBlobs = [];');
code = code.replace(/_breadcrumbs/g, '_blobs');
code = code.replace(/_spawnBreadcrumb/g, '_spawnBlob');
code = code.replace(/rpl-breadcrumb/g, 'rpl-blob');
code = code.replace(/rpl_bc_/g, 'rpl_blob_');

// 2. Add 'Dismiss' button inside the tip HTML
code = code.replace(
    /\`\?' \<strong\>\$\{label\}\<\/strong\>\<span class=\"rpl\-blob\-id\"\>\$\{promptId\}\<\/span\>\`/,
    '\`?\\' <strong>${label}</strong><span class=\"rpl-blob-id\">${promptId}</span><br><button onclick=\"localStorage.setItem(\\'_rpl_dismissed_${promptId}\\', \\'1\\'); document.getElementById(\\'_rpl_blob_${promptId}\\').remove(); this.parentNode.remove();\" style=\"margin-top:6px; background:rgba(255,255,255,0.1); border:none; color:#fff; padding:2px 6px; border-radius:4px; cursor:pointer; font-size:9px; pointer-events:auto;\">Dismiss</button>\`'
);

// Note: pointer-events:none on the tip container needs to be disabled so the button works
code = code.replace('pointer-events: none;', 'pointer-events: auto;');


// 3. Add _fetchPendingBlobs and _renderBlobsForCurrentPage before _autoViewFromUrl
const blobFunctions = `
    function _fetchPendingBlobs() {
        // Build url to prompt_log.json relative to the apiEndpoint
        let url = '/data/prompt_log.json';
        if (window.rippleConfig && window.rippleConfig.apiEndpoint) {
            url = window.rippleConfig.apiEndpoint.replace('api/capture_prompt.php', 'data/prompt_log.json');
        }
        fetch(url + '?t=' + Date.now())
            .then(r => r.json())
            .then(prompts => {
                const projectKey = window.rippleConfig ? window.rippleConfig.projectKey : 'unknown';
                _pendingBlobs = prompts.filter(p => p.status === 'pending' && p.projectKey === projectKey);
                _renderBlobsForCurrentPage();
            })
            .catch(() => {});
    }

    function _renderBlobsForCurrentPage() {
        const currentFullUrl = location.href;
        
        // Remove existing blobs
        _blobs.forEach(b => {
            if (b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
        });
        _blobs.length = 0;

        _pendingBlobs.forEach(p => {
            if (localStorage.getItem('_rpl_dismissed_' + p.promptId)) return;
            // Naive match, check if pageUrl matches current location
            if (p.pageUrl === currentFullUrl || (p.pageUrl && currentFullUrl.includes(p.pageUrl))) {
                if (p.captureX !== undefined && p.captureY !== undefined) {
                    let dashUrl = '/ripple/';
                    if (window.rippleConfig && window.rippleConfig.apiEndpoint) {
                        dashUrl = window.rippleConfig.apiEndpoint.replace('api/capture_prompt.php', '');
                    }
                    _spawnBlob(p.captureX, p.captureY, p.promptId, p.prompt, dashUrl);
                }
            }
        });
    }
`;

code = code.replace('function _autoViewFromUrl() {', blobFunctions + '\n    function _autoViewFromUrl() {');

// 4. Call _renderBlobsForCurrentPage in _autoViewFromUrl
code = code.replace('Ripple.setView(path);', 'Ripple.setView(path);\n        if (typeof _renderBlobsForCurrentPage === \\'function\\') _renderBlobsForCurrentPage();');

// 5. Call _fetchPendingBlobs on init
code = code.replace("if (document.readyState === 'loading') {", "if (typeof _fetchPendingBlobs === 'function') _fetchPendingBlobs();\n    if (document.readyState === 'loading') {");

fs.writeFileSync('src/tracker/ripple-tracker.js', code);
console.log('Successfully updated ripple-tracker.js');
