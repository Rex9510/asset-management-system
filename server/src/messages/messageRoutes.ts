import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getMessages, getMessageById, getUnreadCount } from './messageService';

const router = Router();

// All message routes require authentication
router.use(authMiddleware);

// GET / - List messages with optional type filter and pagination
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const type = req.query.type as string | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = getMessages(userId, { type, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /unread-count - Get unread message count
router.get('/unread-count', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const count = getUnreadCount(userId);
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// GET /:id - Get message detail and mark as read
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '无效的消息ID' } });
      return;
    }

    const message = getMessageById(userId, id);
    if (!message) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '消息不存在' } });
      return;
    }

    res.json({ message });
  } catch (err) {
    next(err);
  }
});

export default router;
