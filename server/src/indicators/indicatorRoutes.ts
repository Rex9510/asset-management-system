import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getIndicators } from './indicatorService';
import { detectRiskAlerts } from './riskDetectionService';

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

// GET /api/indicators/:stockCode/risks - Get risk alerts for suspicious patterns
router.get('/:stockCode/risks', (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.params.stockCode as string;
    const alerts = detectRiskAlerts(stockCode);
    res.json({ stockCode, alerts });
  } catch (err) {
    next(err);
  }
});

export default router;
