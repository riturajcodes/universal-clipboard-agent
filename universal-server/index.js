// auraverse
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import http from 'http';
import { setupWebSocket } from './ws/signaling.js';
import roomsRoutes from './routes/rooms.js';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

app.use('/api/rooms', roomsRoutes);

const server = http.createServer(app);

setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
