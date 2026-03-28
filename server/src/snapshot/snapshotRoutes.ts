import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getChartData } from './snapshotService';

const router = Router();
router.use(authMiddleware);

const VALID_PERIODS = ['7d', '30d', '90d'];

// GET /api/snapshot/chart-data?period=30d
router.get('/chart-data', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const period = typeof req.query.period === 'string' && VALID_PERIODS.includes(req.query.period)
      ? req.query.period
      : '30d';
    const data = getChartData(userId, period);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
