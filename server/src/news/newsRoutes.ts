import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getNews } from './newsService';

const router = Router();

// All news routes require authentication
router.use(authMiddleware);

/**
 * GET /api/news/:stockCode?limit=10
 * Returns news summary list for a given stock.
 * Requirements: 13.1, 13.3
 */
router.get('/:stockCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.params.stockCode as string;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 50);
    const news = await getNews(stockCode, limit);
    res.json({ news });
  } catch (err) {
    next(err);
  }
});

export default router;
