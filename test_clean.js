const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'src/dashboard/index.html'), 'utf8');
const p1 = html.indexOf('<div id="quick-nav"');
const p2 = html.indexOf('<div id="quick-nav"', p1 + 1);
console.log('p1:', p1, 'p2:', p2);
if (p1 > -1 && p2 > -1) {
    // Delete the chunk between p1 and p2?
    // Wait, let's see what precedes p1:
    // It's `<div class="card" ...>`
    // The duplicated section seems to start at `</style>\n<script src="...echarts...` 
    // Let's find exactly where the duplication begins and ends.
    const dupStart = html.indexOf('</style>', p1);
    const dupEnd = p2;
    console.log('Duplication from', dupStart, 'to', dupEnd);
}
