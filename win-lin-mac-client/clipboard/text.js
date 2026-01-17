const clipboardy = require('clipboardy');

async function readText() {
    try {
        return await clipboardy.read();
    } catch (err) {
        console.error('Clipboard text read error', err);
        return '';
    }
}

async function writeText(text) {
    try {
        await clipboardy.write(text);
    } catch (err) {
        console.error('Clipboard text write error', err);
    }
}

module.exports = { readText, writeText };
