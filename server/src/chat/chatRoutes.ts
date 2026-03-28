import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendMessage, getChatHistory, detectSellIntent } from './chatService';
import { Errors } from '../errors/AppError';

const router = Router();

// All chat routes require authentication
router.use(authMiddleware);

// POST /send - Send a message and get AI response
router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { content, stockCode } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      throw Errors.badRequest('消息内容不能为空');
    }

    const response = await sendMessage(userId, content, stockCode);

    // Check for sell intent and include flag in response
    const hasSellIntent = detectSellIntent(content);

    res.json({
      message: response,
      sellIntentDetected: hasSellIntent,
    });
  } catch (err) {
    next(err);
  }
});

// GET /history - Get chat history
router.get('/history', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const messages = getChatHistory(userId, limit);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

export default router;
