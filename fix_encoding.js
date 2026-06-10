const { execSync } = require('child_process');
const fs = require('fs');

// Get pristine file content directly from git using UTF-8
const pristine = execSync('git show 93d3410:src/tracker/ripple-tracker.js', { encoding: 'utf8' });

let tracker = pristine;

// 1. Add CSS
const cssTarget = `                ._rpl_btn_cancel:hover {
                    border-color: rgba(255,255,255,0.2);
                    color: rgba(220,210,255,0.9);
                }`;
const cssReplacement = `                ._rpl_btn_cancel:hover {
                    border-color: rgba(255,255,255,0.2);
                    color: rgba(220,210,255,0.9);
                }
                ._rpl_btn_mic {
                    background: rgba(20,20,50,0.9); border: 1px solid rgba(100,80,200,0.2);
                    color: #c0b8f0; padding: 8px 12px; border-radius: 8px; font-size: 14px;
                    cursor: pointer; flex-shrink: 0; transition: all 0.2s; outline: none;
                }
                ._rpl_btn_mic:hover { background: rgba(40,40,70,0.9); border-color: rgba(120,100,220,0.4); }
                ._rpl_btn_mic.recording {
                    color: #ff4444; border-color: rgba(255,68,68,0.5);
                    animation: rplMicPulse 1.5s infinite;
                }
                @keyframes rplMicPulse {
                    0% { box-shadow: 0 0 0 0 rgba(255,68,68,0.4); }
                    70% { box-shadow: 0 0 0 6px rgba(255,68,68,0); }
                    100% { box-shadow: 0 0 0 0 rgba(255,68,68,0); }
                }`;
tracker = tracker.replace(cssTarget, cssReplacement);

// 2. Add HTML
const htmlTarget = `<div class="_rpl_controls">
                    <select id="_rpl_cat_select" class="_rpl_cat_select" aria-label="Category">${"$"}{catOpts}</select>
                    <button id="_rpl_btn_cancel" class="_rpl_btn_cancel">Cancel</button>`;
const htmlReplacement = `<div class="_rpl_controls">
                    <select id="_rpl_cat_select" class="_rpl_cat_select" aria-label="Category">${"$"}{catOpts}</select>
                    <button id="_rpl_btn_mic" class="_rpl_btn_mic" title="Use Microphone">🎤</button>
                    <button id="_rpl_btn_cancel" class="_rpl_btn_cancel">Cancel</button>`;
tracker = tracker.replace(htmlTarget, htmlReplacement);

// 3. Add JS
const jsTarget = `        // Shift+Enter submit (prompt mode only)
        if (!_homeMode && textarea) {
            textarea.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    document.getElementById('_rpl_btn_send').click();
                }
            });
        }`;
const jsReplacement = `        // Shift+Enter submit (prompt mode only)
        if (!_homeMode && textarea) {
            textarea.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    document.getElementById('_rpl_btn_send').click();
                }
            });
        }

        // 🎤 Speech Recognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const _micBtn = document.getElementById('_rpl_btn_mic');
        if (_micBtn) {
            if (!SpeechRecognition) {
                _micBtn.style.display = 'none';
            } else {
                let _recognition = new SpeechRecognition();
                _recognition.continuous = true;
                _recognition.interimResults = true;
                let _isRecording = false;
                let _originalText = '';
                
                _recognition.onstart = function() {
                    _isRecording = true;
                    _micBtn.classList.add('recording');
                    _micBtn.title = "Listening...";
                };
                
                _recognition.onresult = function(event) {
                    let transcript = '';
                    for (let i = 0; i < event.results.length; i++) {
                        transcript += event.results[i][0].transcript;
                    }
                    if (textarea) textarea.value = _originalText + transcript;
                };
                
                _recognition.onerror = function(event) {
                    console.error("Ripple Speech Error: ", event.error);
                    _recognition.stop();
                };
                
                _recognition.onend = function() {
                    _isRecording = false;
                    _micBtn.classList.remove('recording');
                    _micBtn.title = "Use Microphone";
                    if (textarea) {
                        textarea.focus();
                        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
                    }
                };
                
                _micBtn.addEventListener('click', function() {
                    if (_isRecording) {
                        _recognition.stop();
                    } else {
                        _originalText = textarea ? textarea.value : '';
                        if (_originalText && !_originalText.endsWith(' ') && !_originalText.endsWith('\\n')) {
                            _originalText += ' ';
                        }
                        _recognition.start();
                    }
                });
            }
        }`;
tracker = tracker.replace(jsTarget, jsReplacement);

// 4. Fix version
tracker = tracker.replace("const RIPPLE_VERSION = 'v0.8.1';", "const RIPPLE_VERSION = 'v0.9.1';");

fs.writeFileSync('src/tracker/ripple-tracker.js', '\ufeff' + tracker, 'utf8'); // Force UTF8 with BOM
console.log('Fixed exactly.');
