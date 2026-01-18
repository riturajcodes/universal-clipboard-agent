import express from 'express';
import { v4 as uuidv4 } from 'uuid';
const router = express.Router();

router.post('/create', (req, res) => {
    const roomId = uuidv4();
    res.json({ roomId });
});

export default router;
