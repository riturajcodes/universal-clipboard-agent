import express from 'express';
const router = express.Router();

// In-memory users store (optional)
const users = {};

// Register a user
router.post('/register', (req, res) => {
    const { userId, deviceName, os } = req.body;
    users[userId] = { deviceName, os };
    res.json({ success: true });
});

export default router;
