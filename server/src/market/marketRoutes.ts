import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getQuote } from './marketDataService';

const router = Router();

// All market routes require authentication
router.use(authMiddleware);

// GET /api/market/quote/:code - Get a single stock quote
router.get('/quote/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.params.code as string;
    const quote = await getQuote(stockCode);
    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

export default router;
