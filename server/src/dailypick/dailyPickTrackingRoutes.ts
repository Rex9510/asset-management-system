import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getTrackingList, getAccuracyStats } from './dailyPickTrackingService';

const router = Router();
router.use(authMiddleware);

// GET /api/daily-pick/tracking
router.get('/tracking', (req: Request, res: Response, next: NextFunction) => {
  try {
    const trackings = getTrackingList(req.user!.id);
    res.json({ trackings });
  } catch (err) {
    next(err);
  }
});

// GET /api/daily-pick/accuracy
router.get('/accuracy', (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = getAccuracyStats(req.user!.id);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
