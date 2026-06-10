const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'audience.js');
let c = fs.readFileSync(filePath, 'utf8');
c = c.replace(/\\`/g, '`');
c = c.replace(/\\$/g, '$');
c = c.replace(/\\\\n/g, '\\n');
fs.writeFileSync(filePath, c);
console.log('Fixed audience.js');
