import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { analysisTriggerUserLimiter } from '../middleware/rateLimits';
import { triggerAnalysis, getAnalysisHistory } from './analysisService';
import { Errors } from '../errors/AppError';

const router = Router();

// All analysis routes require authentication
router.use(authMiddleware);

// POST /api/analysis/trigger - Manually trigger analysis for a stock
router.post('/trigger', analysisTriggerUserLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { stockCode } = req.body;

    if (!stockCode || typeof stockCode !== 'string') {
      throw Errors.badRequest('请提供股票代码');
    }

    const analysis = await triggerAnalysis(stockCode.trim(), userId, 'manual');
    res.json({ analysis });
  } catch (err) {
    next(err);
  }
});

// GET /api/analysis/:stockCode - Get analysis history for a stock
router.get('/:stockCode', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const stockCode = req.params.stockCode as string;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    const analyses = getAnalysisHistory(stockCode, userId, limit);
    res.json({ analyses });
  } catch (err) {
    next(err);
  }
});

export default router;
