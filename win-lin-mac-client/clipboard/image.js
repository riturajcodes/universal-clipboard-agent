const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

function readImage() {
    return new Promise((resolve, reject) => {
        const tempPath = path.join(os.tmpdir(), 'clipboard_image.png');

        if (os.platform() === 'win32') {
            // Windows: using powershell
            exec(`powershell.exe -command "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) {$img.Save('${tempPath}')}"`, (err) => {
                if (err) return reject(err);
                fs.readFile(tempPath, (err, data) => {
                    if (err) return reject(err);
                    resolve(data.toString('base64'));
                });
            });
        } else if (os.platform() === 'darwin') {
            // macOS: using pngpaste
            exec(`pngpaste ${tempPath}`, (err) => {
                if (err) return reject(err);
                fs.readFile(tempPath, (err, data) => {
                    if (err) return reject(err);
                    resolve(data.toString('base64'));
                });
            });
        } else {
            // Linux: using xclip
            exec(`xclip -selection clipboard -t image/png -o > ${tempPath}`, (err) => {
                if (err) return reject(err);
                fs.readFile(tempPath, (err, data) => {
                    if (err) return reject(err);
                    resolve(data.toString('base64'));
                });
            });
        }
    });
}

module.exports = { readImage };
