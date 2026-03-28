import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getOperationLogs, getReviews } from './operationLogService';

const router = Router();
router.use(authMiddleware);

// GET /api/oplog?page=1&limit=20
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const result = getOperationLogs(userId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/oplog/review
router.get('/review', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const reviews = getReviews(userId);
    res.json(reviews);
  } catch (err) {
    next(err);
  }
});

export default router;
