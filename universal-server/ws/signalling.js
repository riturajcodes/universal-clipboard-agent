const WebSocket = require('ws');

// Keep rooms and clients in memory
const rooms = {}; // roomId -> [clients]

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        console.log('Client connected');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.type) {
                    case 'join':
                        const { roomId, userId, os } = data;
                        ws.userId = userId;
                        ws.roomId = roomId;

                        if (!rooms[roomId]) rooms[roomId] = [];
                        rooms[roomId].push(ws);

                        // Notify all clients in the room about new peer
                        broadcastRoom(roomId, {
                            type: 'peer-joined',
                            userId,
                            os
                        }, ws);
                        break;

                    case 'signal':
                        // Forward signal (offer/answer/ICE) to target peer
                        const { targetId, signalData } = data;
                        const target = rooms[ws.roomId]?.find(c => c.userId === targetId);
                        if (target) {
                            target.send(JSON.stringify({
                                type: 'signal',
                                from: ws.userId,
                                signalData
                            }));
                        }
                        break;

                    default:
                        console.log('Unknown message type:', data.type);
                }
            } catch (err) {
                console.error('Error parsing message', err);
            }
        });

        ws.on('close', () => {
            console.log('Client disconnected');
            if (ws.roomId && rooms[ws.roomId]) {
                rooms[ws.roomId] = rooms[ws.roomId].filter(c => c !== ws);
                broadcastRoom(ws.roomId, {
                    type: 'peer-left',
                    userId: ws.userId
                });
            }
        });
    });

    console.log('WebSocket server running');
}

function broadcastRoom(roomId, data, excludeWs = null) {
    rooms[roomId]?.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

module.exports = { setupWebSocket };
