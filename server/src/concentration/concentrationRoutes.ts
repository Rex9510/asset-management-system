import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getConcentration } from './concentrationService';

const router = Router();
router.use(authMiddleware);

// GET /api/concentration
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const result = getConcentration(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
