import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getCurrentRotation } from './rotationService';

const router = Router();
router.use(authMiddleware);

// GET /api/rotation/current
router.get('/current', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = getCurrentRotation();
    if (!data) {
      res.json({ currentPhase: null, message: '暂无轮动数据' });
      return;
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
