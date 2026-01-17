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
            rooms[roomId] = { clients: new Set(), lastClipboard: null };
          }
          rooms[roomId].clients.add(ws);
          console.log(`User ${userId} joined room ${roomId}`);

          const peers = Array.from(rooms[roomId].clients)
            .filter(client => client !== ws && client.readyState === 1)
            .map(client => ({ userId: client.userId, os: client.os }));
          
          ws.send(JSON.stringify({ type: 'existing-peers', peers }));

          if (rooms[roomId].lastClipboard) {
            ws.send(JSON.stringify({
              type: 'clipboard',
              ...rooms[roomId].lastClipboard
            }));
          }

          broadcastToRoom(roomId, { type: 'peer-joined', userId, os }, ws);

        } else if (data.type === 'clipboard') {
          if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].lastClipboard = {
              content: data.content,
              type: data.clipboardType,
              timestamp: data.timestamp
            };
            broadcastToRoom(currentRoom, data, ws);
          }
        } else if (data.type === 'signal') {
          broadcastToRoom(currentRoom, data, ws);
        } else if (data.type === 'file-transfer') {
          broadcastToRoom(currentRoom, data, ws);
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