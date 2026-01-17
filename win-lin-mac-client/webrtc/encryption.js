const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY = crypto.randomBytes(32); // In production, generate per room/device

function encrypt(data) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv: iv.toString('hex'), tag: tag.toString('hex'), data: encrypted.toString('hex') };
}

function decrypt(enc) {
    const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(enc.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(enc.data, 'hex')), decipher.final()]);
    return JSON.parse(decrypted.toString());
}

module.exports = { encrypt, decrypt };
