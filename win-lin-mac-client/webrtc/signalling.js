const WebSocket = require('ws');
const { MESSAGE_TYPES } = require('../shared/constants');

function setupSignaling(serverUrl, roomId, userId, onPeerSignal) {
    const ws = new WebSocket(serverUrl);

    ws.on('open', () => {
        console.log('Connected to central server for signaling');
        ws.send(JSON.stringify({
            type: MESSAGE_TYPES.JOIN,
            roomId,
            userId,
            os: process.platform
        }));
    });

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        switch (data.type) {
            case MESSAGE_TYPES.SIGNAL:
                onPeerSignal(data.from, data.signalData);
                break;
            case MESSAGE_TYPES.PEER_JOINED:
            case MESSAGE_TYPES.PEER_LEFT:
                console.log(data.type, data.userId);
                break;
        }
    });

    function sendSignal(targetId, signalData) {
        ws.send(JSON.stringify({
            type: MESSAGE_TYPES.SIGNAL,
            targetId,
            signalData
        }));
    }

    return { ws, sendSignal };
}

module.exports = { setupSignaling };
