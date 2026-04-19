import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { calmDownEvaluateUserLimiter } from '../middleware/rateLimits';
import { evaluateCalmDown } from './chatService';
import { Errors } from '../errors/AppError';

const router = Router();

// All calm-down routes require authentication
router.use(authMiddleware);

// POST /evaluate - Evaluate calm-down for a stock
router.post('/evaluate', calmDownEvaluateUserLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { stockCode } = req.body;

    if (!stockCode || typeof stockCode !== 'string') {
      throw Errors.badRequest('请提供股票代码');
    }

    const evaluation = await evaluateCalmDown(userId, stockCode.trim());
    res.json({ evaluation });
  } catch (err) {
    next(err);
  }
});

export default router;
