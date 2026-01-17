import express from 'express';
import { v4 as uuidv4 } from 'uuid';
const router = express.Router();

// In-memory rooms store
const rooms = {};

// Create a new room
router.post('/create', (req, res) => {
    const roomId = uuidv4();
    rooms[roomId] = {
        id: roomId,
        users: []
    };
    res.json({ roomId });
});

// List all rooms (optional)
router.get('/', (req, res) => {
    res.json(Object.values(rooms));
});

// Join a room (for API clients)
router.post('/:roomId/join', (req, res) => {
    const { roomId } = req.params;
    const { userId, deviceName, os } = req.body;

    if (!rooms[roomId]) return res.status(404).json({ error: 'Room not found' });

    rooms[roomId].users.push({ userId, deviceName, os });
    res.json({ success: true, room: rooms[roomId] });
});

export default router;
