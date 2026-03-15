import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getIndicators } from './indicatorService';

const router = Router();

// All indicator routes require authentication
router.use(authMiddleware);

// GET /api/indicators/:stockCode - Get technical indicators and signal interpretations
router.get('/:stockCode', (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.params.stockCode as string;
    const indicators = getIndicators(stockCode);
    res.json(indicators);
  } catch (err) {
    next(err);
  }
});

export default router;
