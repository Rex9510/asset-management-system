import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { runBacktest } from './backtestService';

const router = Router();
router.use(authMiddleware);

// POST /api/backtest/:stockCode
router.post('/:stockCode', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stockCode } = req.params;
    if (!stockCode || typeof stockCode !== 'string' || !stockCode.trim()) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请提供股票代码' } });
      return;
    }
    const result = runBacktest(stockCode.trim());
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
