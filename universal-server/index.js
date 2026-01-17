import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import http from 'http';
import { setupWebSocket } from './ws/signaling.js';
import roomsRoutes from './routes/rooms.js';
import usersRoutes from './routes/users.js';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// API routes
app.use('/api/rooms', roomsRoutes);
app.use('/api/users', usersRoutes);

// Create HTTP server for both Express + WebSocket
const server = http.createServer(app);

// Setup WebSocket signaling
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
