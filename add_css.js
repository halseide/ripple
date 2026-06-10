const fs = require('fs');
let tracker = fs.readFileSync('src/tracker/ripple-tracker.js', 'utf8');

const targetStr = `                ._rpl_status {`;
const cssReplacement = `
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
                }
                ._rpl_status {`;

tracker = tracker.replace(targetStr, cssReplacement);

fs.writeFileSync('src/tracker/ripple-tracker.js', tracker);
console.log('CSS added.');
