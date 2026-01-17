import express from 'express';
import path from 'path';
import http from 'http';
import WebSocket from 'ws';
import clipboardy from 'clipboardy';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import {CLIPBOARD_TYPES, MESSAGE_TYPES, TRANSFER_ACTIONS} from './constants.js';
import wrtc from 'wrtc';
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

const app = express();
const PORT = 4000;
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
    
    peerConnections[targetId] = { pc, dc };

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
            peerConnections[senderId] = { pc, dc: null };
            
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
                peerConnections[senderId].dc = dc;
                setupDataChannel(dc, senderId);
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
    } else if (data.type === MESSAGE_TYPES.FILE_TRANSFER) {
        const { action, transferId } = data;
        if (action === TRANSFER_ACTIONS.START) {
            const fileName = decrypt(data.fileName);
            const downloadDir = path.join(__dirname, 'downloads');
            if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);
            const safeFileName = `${Date.now()}-${path.basename(fileName)}`;
            const filePath = path.join(downloadDir, safeFileName);
            const writeStream = fs.createWriteStream(filePath);
            incomingTransfers.set(transferId, { writeStream, fileName, senderId: data.senderId });
            console.log(`Starting download: ${fileName}`);
        } else if (action === TRANSFER_ACTIONS.CHUNK) {
            const transfer = incomingTransfers.get(transferId);
            if (transfer) {
                const chunk = Buffer.from(decrypt(data.content), 'base64');
                transfer.writeStream.write(chunk);
            }
        } else if (action === TRANSFER_ACTIONS.END) {
            const transfer = incomingTransfers.get(transferId);
            if (transfer) {
                transfer.writeStream.end();
                console.log(`Finished download: ${transfer.fileName}`);
                history.unshift({
                    type: CLIPBOARD_TYPES.FILE,
                    content: `File received: ${transfer.fileName}`,
                    senderId: transfer.senderId,
                    timestamp: Date.now()
                });
                incomingTransfers.delete(transferId);
            }
        }
    }
}

function sendFile(filePath) {
    try {
        const transferId = crypto.randomUUID();
        const fileName = path.basename(filePath);
        const stats = fs.statSync(filePath);
        
        console.log(`Sending file: ${fileName} (${stats.size} bytes)`);

        const startMsg = JSON.stringify({
            type: MESSAGE_TYPES.FILE_TRANSFER,
            action: TRANSFER_ACTIONS.START,
            transferId,
            fileName: encrypt(fileName),
            senderId: USER_ID
        });
        Object.values(peerConnections).forEach(({ dc }) => { if (dc && dc.readyState === 'open') dc.send(startMsg); });

        const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks
        
        stream.on('data', (chunk) => {
            const chunkMsg = JSON.stringify({
                    type: MESSAGE_TYPES.FILE_TRANSFER,
                    action: TRANSFER_ACTIONS.CHUNK,
                    transferId,
                    content: encrypt(chunk.toString('base64'))
            });
            Object.values(peerConnections).forEach(({ dc }) => { if (dc && dc.readyState === 'open') dc.send(chunkMsg); });
        });

        stream.on('error', (err) => {
            console.error('Error reading file stream:', err);
        });

        stream.on('end', () => {
            const endMsg = JSON.stringify({
                type: MESSAGE_TYPES.FILE_TRANSFER,
                action: TRANSFER_ACTIONS.END,
                transferId
            });
            Object.values(peerConnections).forEach(({ dc }) => { if (dc && dc.readyState === 'open') dc.send(endMsg); });
            console.log('File sent successfully');
        });
    } catch (err) {
        console.error('Error sending file:', err);
    }
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
