const fs = require('fs');
let tracker = fs.readFileSync('src/tracker/ripple-tracker.js', 'utf8');

// 1. Add CSS
const cssReplacement = `
                ._rpl_btn_cancel:hover { background: rgba(50,50,80,0.9); border-color: rgba(120,100,220,0.3); }
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
tracker = tracker.replace('._rpl_btn_cancel:hover { background: rgba(50,50,80,0.9); border-color: rgba(120,100,220,0.3); }', cssReplacement);

// 2. Add HTML
const htmlReplacement = `
                <div class="_rpl_controls">
                    <select id="_rpl_cat_select" class="_rpl_cat_select" aria-label="Category">${"$"}{catOpts}</select>
                    <button id="_rpl_btn_mic" class="_rpl_btn_mic" title="Use Microphone">🎤</button>
                    <button id="_rpl_btn_cancel" class="_rpl_btn_cancel">Cancel</button>
`;
tracker = tracker.replace(/<div class="_rpl_controls">\s*<select id="_rpl_cat_select" class="_rpl_cat_select" aria-label="Category">\$\{catOpts\}<\/select>\s*<button id="_rpl_btn_cancel" class="_rpl_btn_cancel">Cancel<\/button>/, htmlReplacement.trim());

// 3. Add JS Logic
const jsReplacement = `
        // Shift+Enter submit (prompt mode only)
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
                _recognition.continuous = false;
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
        }
`;

tracker = tracker.replace(/        \/\/ Shift\+Enter submit \(prompt mode only\)\s*if \(!_homeMode && textarea\) \{\s*textarea\.addEventListener\('keydown', function \(e\) \{\s*if \(e\.key === 'Enter' && e\.shiftKey\) \{\s*e\.preventDefault\(\);\s*document\.getElementById\('_rpl_btn_send'\)\.click\(\);\s*\}\s*\}\);\s*\}/, jsReplacement.trim());

fs.writeFileSync('src/tracker/ripple-tracker.js', tracker);
console.log('Done.');
