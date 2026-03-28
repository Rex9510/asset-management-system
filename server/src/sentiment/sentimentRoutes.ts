import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getCurrentSentiment } from './sentimentService';

const router = Router();
router.use(authMiddleware);

// GET /api/sentiment/current
router.get('/current', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = getCurrentSentiment();
    if (!data) {
      res.json({ score: null, message: '暂无情绪数据' });
      return;
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
