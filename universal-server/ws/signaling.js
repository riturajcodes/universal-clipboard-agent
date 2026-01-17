import { WebSocketServer } from 'ws';

const rooms = {};

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    let currentRoom = null;
    let currentUserId = null;

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        if (data.type === 'join') {
          const { roomId, userId, os } = data;
          currentRoom = roomId;
          currentUserId = userId;
          ws.userId = userId;
          ws.os = os;

          if (!rooms[roomId]) {
            rooms[roomId] = { clients: new Set() };
          }
          rooms[roomId].clients.add(ws);
          console.log(`User ${userId} joined room ${roomId}`);

          const peers = Array.from(rooms[roomId].clients)
            .filter(client => client !== ws && client.readyState === 1)
            .map(client => ({ userId: client.userId, os: client.os }));
          
          ws.send(JSON.stringify({ type: 'existing-peers', peers }));

          broadcastToRoom(roomId, { type: 'peer-joined', userId, os }, ws);

        } else if (data.type === 'signal') {
          const payload = { ...data, senderId: currentUserId };
          if (data.target) {
            const targetWs = Array.from(rooms[currentRoom].clients).find(client => client.userId === data.target);
            if (targetWs && targetWs.readyState === 1) {
              targetWs.send(JSON.stringify(payload));
            }
          } else {
            broadcastToRoom(currentRoom, payload, ws);
          }
        }
      } catch (e) {
        console.error('Error processing message:', e);
      }
    });

    ws.on('close', () => {
      console.log(`Client disconnected: ${currentUserId}`);
      if (currentRoom && rooms[currentRoom]) {
        rooms[currentRoom].clients.delete(ws);
        broadcastToRoom(currentRoom, { type: 'peer-left', userId: currentUserId }, ws);
        if (rooms[currentRoom].clients.size === 0) {
          delete rooms[currentRoom];
        }
      }
    });
  });
}

function broadcastToRoom(roomId, data, senderWs) {
  if (!rooms[roomId]) return;
  for (const client of rooms[roomId].clients) {
    if (client !== senderWs && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  }
}