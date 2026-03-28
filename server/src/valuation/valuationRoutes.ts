import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getValuation } from './valuationService';

const router = Router();

// All valuation routes require authentication
router.use(authMiddleware);

// GET /api/valuation/:stockCode - Get valuation percentile data
router.get('/:stockCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.params.stockCode as string;
    const data = await getValuation(stockCode);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
