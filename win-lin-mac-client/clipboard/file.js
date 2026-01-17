// Optional file clipboard handling (example: Windows only)
const fs = require('fs');

function readFile(path) {
    return fs.readFileSync(path).toString('base64');
}

function writeFile(path, base64) {
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(path, buffer);
}

module.exports = { readFile, writeFile };
