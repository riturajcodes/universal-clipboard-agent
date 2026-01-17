import express from 'express';
import path from 'path';
import http from 'http';
import WebSocket from 'ws';
import clipboardy from 'clipboardy';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { compress, decompress } from '@mongodb-js/zstd';
import {CLIPBOARD_TYPES, MESSAGE_TYPES, TRANSFER_ACTIONS} from './constants.js';
import wrtc from 'wrtc';
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

const app = express();
const PORT = 4001;
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
app.use(express.static(path.join(__dirname, 'ui')));

app.post('/api/join', (req, res) => {
    const { roomId } = req.body;
    if (roomId) {
        ROOM_ID = roomId;
        connect();
        res.json({ success: true, roomId });
    } else {
        res.status(400).json({ error: 'Room ID required' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ 
        roomId: ROOM_ID, 
        connected: ws?.readyState === WebSocket.OPEN, 
        peers: Array.from(peers),
        history 
    });
});

const server = http.createServer(app);
server.listen(PORT, () => {
    console.log(`Client UI running at http://localhost:${PORT}`);
});

const SERVER_URL = 'ws://localhost:3000';
let ROOM_ID = process.env.ROOM_ID || null;
const USER_ID = `client-${Math.floor(Math.random() * 10000)}`;
const OS = process.platform;

let ws;
let lastClip = '';
let peers = new Set();
let history = [];
const incomingTransfers = new Map();
const pendingChunks = new Map();
const peerConnections = {};
const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

const ALGORITHM = 'aes-256-gcm';
const getKey = () => crypto.scryptSync(ROOM_ID || 'default-secret', 'salt', 32);

function encrypt(text) {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({ iv: iv.toString('hex'), content: encrypted, tag: authTag });
}

function decrypt(encryptedWrapper) {
    try {
        const { iv, content, tag } = JSON.parse(encryptedWrapper);
        const key = getKey();
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        let decrypted = decipher.update(content, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null;
    }
}

function connect() {
    if (ws) {
        ws.removeAllListeners();
        ws.terminate();
    }
    ws = new WebSocket(SERVER_URL);

    ws.on('open', () => {
        console.log('Connected to central server');
        ws.send(JSON.stringify({
            type: MESSAGE_TYPES.JOIN,
            roomId: ROOM_ID || 'default',
            userId: USER_ID,
            os: OS
        }));
        peers.clear();
        history = [];
    });

    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);

            switch (data.type) {
                case MESSAGE_TYPES.PEER_JOINED:
                    console.log('Peer joined:', data.userId);
                    peers.add(`${data.userId} (${data.os || 'unknown'})`);
                    break;

                case MESSAGE_TYPES.PEER_LEFT:
                    console.log('Peer left:', data.userId);
                    if (peerConnections[data.userId]) {
                        peerConnections[data.userId].pc.close();
                        delete peerConnections[data.userId];
                    }
                    peers = new Set(Array.from(peers).filter(p => !p.startsWith(data.userId)));
                    break;

                case MESSAGE_TYPES.EXISTING_PEERS:
                    data.peers.forEach(p => {
                        peers.add(`${p.userId} (${p.os})`);
                        initiatePeerConnection(p.userId);
                    });
                    break;
                case MESSAGE_TYPES.SIGNAL:
                    await handleSignal(data);
                    break;
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });

    ws.on('close', () => {
        console.log('Disconnected. Reconnecting in 3s...');
        setTimeout(connect, 3000);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        ws.close();
    });
}

connect();

async function initiatePeerConnection(targetId) {
    const pc = new RTCPeerConnection(iceConfig);
    const dc = pc.createDataChannel("universal-clipboard");
    setupDataChannel(dc, targetId);
    
    const fileDc = pc.createDataChannel("file-transfer");
    fileDc.binaryType = 'arraybuffer';
    fileDc.bufferedAmountLowThreshold = 65536; // FIX: Set backpressure threshold
    setupFileChannel(fileDc, targetId);
    
    peerConnections[targetId] = { pc, dc, fileDc };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: MESSAGE_TYPES.SIGNAL,
                target: targetId,
                signalType: 'candidate',
                candidate: event.candidate
            }));
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({
        type: MESSAGE_TYPES.SIGNAL,
        target: targetId,
        signalType: 'offer',
        sdp: pc.localDescription
    }));
}

async function handleSignal(data) {
    const { senderId, signalType, sdp, candidate } = data;
    
    let pc;
    if (peerConnections[senderId]) {
        pc = peerConnections[senderId].pc;
    } else {
        if (signalType === 'offer') {
            pc = new RTCPeerConnection(iceConfig);
            peerConnections[senderId] = { pc, dc: null, fileDc: null };
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    ws.send(JSON.stringify({
                        type: MESSAGE_TYPES.SIGNAL,
                        target: senderId,
                        signalType: 'candidate',
                        candidate: event.candidate
                    }));
                }
            };

            pc.ondatachannel = (event) => {
                const dc = event.channel;
                if (dc.label === 'file-transfer') {
                    dc.binaryType = 'arraybuffer';
                    dc.bufferedAmountLowThreshold = 65536; // FIX: Set backpressure threshold
                    peerConnections[senderId].fileDc = dc;
                    setupFileChannel(dc, senderId);
                } else {
                    peerConnections[senderId].dc = dc;
                    setupDataChannel(dc, senderId);
                }
            };
        } else {
            return;
        }
    }

    if (signalType === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({
            type: MESSAGE_TYPES.SIGNAL,
            target: senderId,
            signalType: 'answer',
            sdp: pc.localDescription
        }));
    } else if (signalType === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } else if (signalType === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

function setupDataChannel(dc, remoteUserId) {
    dc.onopen = () => console.log(`Data channel open with ${remoteUserId}`);
    dc.onmessage = (event) => {
        handleDataMessage(JSON.parse(event.data));
    };
}

function setupFileChannel(dc, remoteUserId) {
    dc.onopen = () => console.log(`File channel open with ${remoteUserId}`);

    dc.onmessage = async (event) => {
        try {
            const data = Buffer.from(event.data);

            // Minimum header: 16 + 4 + 4 + 12 + 16 = 52 bytes
            if (data.length < 52) return;

            const transferId =
                data.subarray(0, 16).toString('hex')
                    .replace(
                        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
                        '$1-$2-$3-$4-$5'
                    );

            const chunkIndex = data.readUInt32BE(16);
            const totalChunks = data.readUInt32BE(20);
            const iv = data.subarray(24, 36);
            const authTag = data.subarray(36, 52);
            const encryptedContent = data.subarray(52);

            let transfer = incomingTransfers.get(transferId);

            if (!transfer) {
                if (!pendingChunks.has(transferId)) {
                    pendingChunks.set(transferId, []);
                }
                pendingChunks.get(transferId).push({
                    chunkIndex,
                    totalChunks,
                    iv,
                    authTag,
                    encryptedContent
                });
                return;
            }

            if (transfer.totalChunks === 0) {
                transfer.totalChunks = totalChunks;
            }

            await handleChunk(
                transfer,
                chunkIndex,
                iv,
                authTag,
                encryptedContent
            );
        } catch (err) {
            console.error('File channel error:', err);
        }
    };
}


async function handleChunk(transfer, index, iv, authTag, encryptedContent) {
    if (index === transfer.nextIndex) {
        try {
            const key = getKey();
            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encryptedContent);
            decrypted = Buffer.concat([decrypted, decipher.final()]);

            const decompressed = await decompress(decrypted);

            transfer.writeStream.write(decompressed);
            transfer.nextIndex++;

            while (transfer.buffer.has(transfer.nextIndex)) {
                const next = transfer.buffer.get(transfer.nextIndex);
                transfer.buffer.delete(transfer.nextIndex);
                await handleChunk(
                    transfer,
                    transfer.nextIndex,
                    next.iv,
                    next.authTag,
                    next.encryptedContent
                );
            }

            checkTransferComplete(transfer);
        } catch (err) {
            console.error('Chunk decrypt/decompress failed:', err);
            transfer.writeStream.destroy();
            incomingTransfers.delete(transfer.transferId);
        }
    } else if (index > transfer.nextIndex) {
        transfer.buffer.set(index, {
            iv,
            authTag,
            encryptedContent
        });
    }
}


function checkTransferComplete(transfer) {
    if (
        transfer.ended &&
        transfer.totalChunks > 0 &&
        transfer.nextIndex >= transfer.totalChunks
    ) {
        transfer.writeStream.end();
        console.log(`Finished download: ${transfer.fileName}`);

        history.unshift({
            type: CLIPBOARD_TYPES.FILE,
            content: `File received: ${transfer.fileName}`,
            senderId: transfer.senderId,
            timestamp: Date.now()
        });

        incomingTransfers.delete(transfer.transferId);
    }
}

async function handleDataMessage(data) {
    if (data.type === MESSAGE_TYPES.CLIPBOARD) {
        const decryptedContent = decrypt(data.content);
        const decryptedFileName = data.fileName ? decrypt(data.fileName) : null;

        if (decryptedContent && decryptedContent !== lastClip) {
            console.log(`Received clipboard (${data.type}) from ${data.senderId}`);

            if (data.clipboardType === CLIPBOARD_TYPES.FILE || data.clipboardType === CLIPBOARD_TYPES.IMAGE) {
                const downloadDir = path.join(__dirname, 'downloads');
                if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
                const fileName = decryptedFileName || `file-${Date.now()}`;
                const filePath = path.join(downloadDir, fileName);
                fs.writeFileSync(filePath, Buffer.from(decryptedContent, 'base64'));
                console.log(`Saved ${data.clipboardType} to ${filePath}`);
            } else {
                lastClip = decryptedContent;
                await clipboardy.write(decryptedContent);
            }

            history.unshift({
                type: data.clipboardType || 'text',
                content: data.clipboardType === CLIPBOARD_TYPES.TEXT ? decryptedContent : `File: ${decryptedFileName}`,
                senderId: data.senderId,
                timestamp: Date.now()
            });
            if (history.length > 20) history.pop();
        }
    }  else if (data.type === MESSAGE_TYPES.FILE_TRANSFER) {
    const { action, transferId } = data;

    if (action === TRANSFER_ACTIONS.START) {
        const fileName = decrypt(data.fileName);
        const downloadDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

        const safeFileName = `${Date.now()}-${path.basename(fileName)}`;
        const filePath = path.join(downloadDir, safeFileName);
        const writeStream = fs.createWriteStream(filePath);

        const transfer = {
            transferId,
            fileName,
            senderId: data.senderId,
            writeStream,
            nextIndex: 0,
            buffer: new Map(),
            totalChunks: data.totalChunks || 0,
            ended: false
        };

        incomingTransfers.set(transferId, transfer);
        console.log(`Starting download: ${fileName}`);

        if (pendingChunks.has(transferId)) {
            const chunks = pendingChunks.get(transferId);
            pendingChunks.delete(transferId);

            for (const c of chunks) {
                if (transfer.totalChunks === 0) {
                    transfer.totalChunks = c.totalChunks;
                }
                await handleChunk(
                    transfer,
                    c.chunkIndex,
                    c.iv,
                    c.authTag,
                    c.encryptedContent
                );
            }
        }

    } else if (action === TRANSFER_ACTIONS.END) {
        let transfer = incomingTransfers.get(transferId);

        if (!transfer) {
            incomingTransfers.set(transferId, {
                transferId,
                ended: true,
                nextIndex: 0,
                buffer: new Map(),
                totalChunks: 0
            });
            return;
        }

        transfer.ended = true;
        checkTransferComplete(transfer);
        }
    }
}

function sendFile(filePath) {
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    console.log(`Sending file: ${fileName} (${stats.size} bytes)`);

    Object.values(peerConnections).forEach(peer => {
        if (
            !peer.dc || peer.dc.readyState !== 'open' ||
            !peer.fileDc || peer.fileDc.readyState !== 'open'
        ) return;

        const transferId = crypto.randomUUID();
        const CHUNK_SIZE = 16 * 1024;
        const totalChunks = Math.ceil(stats.size / CHUNK_SIZE);

        peer.dc.send(JSON.stringify({
            type: MESSAGE_TYPES.FILE_TRANSFER,
            action: TRANSFER_ACTIONS.START,
            transferId,
            fileName: encrypt(fileName),
            senderId: USER_ID,
            totalChunks
        }));

        const transferIdBuf = Buffer.from(
            transferId.replace(/-/g, ''),
            'hex'
        );

        const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
        let chunkIndex = 0;

        stream.on('data', async (chunk) => {
            stream.pause();

            try {
                const compressed = await compress(chunk, 3);

                const iv = crypto.randomBytes(12);
                const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
                let encrypted = cipher.update(compressed);
                encrypted = Buffer.concat([encrypted, cipher.final()]);
                const authTag = cipher.getAuthTag();

                const header = Buffer.alloc(52);
                transferIdBuf.copy(header, 0);
                header.writeUInt32BE(chunkIndex, 16);
                header.writeUInt32BE(totalChunks, 20);
                iv.copy(header, 24);
                authTag.copy(header, 36);

                peer.fileDc.send(Buffer.concat([header, encrypted]));
                chunkIndex++;

                if (peer.fileDc.bufferedAmount < 64 * 1024) {
                    stream.resume();
                }
            } catch (err) {
                console.error('Send chunk failed:', err);
                stream.destroy();
            }
        });

        peer.fileDc.onbufferedamountlow = () => stream.resume();

        stream.on('end', () => {
            peer.dc.send(JSON.stringify({
                type: MESSAGE_TYPES.FILE_TRANSFER,
                action: TRANSFER_ACTIONS.END,
                transferId,
                senderId: USER_ID
            }));
        });

        stream.on('error', err => {
            console.error('File read error:', err);
        });
    });
}


setInterval(async () => {
    try {
        const text = await clipboardy.read();
        if (text && text !== lastClip) {
            lastClip = text;
            const trimmedText = text.trim();
            
            let type = CLIPBOARD_TYPES.TEXT;
            let content = text;
            let fileName = null;
            let isFile = false;

            
            try {
                if (trimmedText.length < 1024 && !trimmedText.includes('\n')) {
                    if (fs.existsSync(trimmedText) && fs.lstatSync(trimmedText).isFile()) {
                        isFile = true;
                    }
                }
            } catch (e) {
            }

            if (isFile) {
                type = CLIPBOARD_TYPES.FILE;
                fileName = path.basename(trimmedText);
                if (/\.(png|jpg|jpeg|gif|bmp)$/i.test(fileName)) {
                    type = CLIPBOARD_TYPES.IMAGE;
                }
                sendFile(trimmedText);
            } else {
                broadcastClipboard(content, type, fileName);
            }

            history.unshift({
                type: type,
                content: type === CLIPBOARD_TYPES.TEXT ? text : `File: ${fileName}`,
                senderId: 'Me',
                timestamp: Date.now()
            });
            if (history.length > 20) history.pop();
        }
    } catch (err) {
        const msg = err.message || err.toString();
        if (msg.includes('wl-paste') && msg.includes('not available')) {
            try {
                const { stdout } = await execAsync('wl-paste --type text/uri-list');
                const uri = stdout.trim().split('\n')[0];
                
                if (uri && uri.startsWith('file://')) {
                    const filePath = fileURLToPath(uri);
                    
                    if (filePath && filePath !== lastClip) {
                        lastClip = filePath;
                        
                        if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
                            sendFile(filePath);
                            
                            history.unshift({
                                type: CLIPBOARD_TYPES.FILE,
                                content: `File: ${path.basename(filePath)}`,
                                senderId: 'Me',
                                timestamp: Date.now()
                            });
                            if (history.length > 20) history.pop();
                        }
                    }
                }
            } catch (e) {
            }
        } else {
            console.error('Clipboard watcher error:', err);
        }
    }
}, 1000);

function broadcastClipboard(content, type, fileName = null) {
    const msg = JSON.stringify({
        type: MESSAGE_TYPES.CLIPBOARD,
        clipboardType: type,
        content: encrypt(content),
        fileName: fileName ? encrypt(fileName) : null,
        senderId: USER_ID,
        timestamp: Date.now()
    });
    Object.values(peerConnections).forEach(({ dc }) => {
        if (dc && dc.readyState === 'open') dc.send(msg);
    });
}
