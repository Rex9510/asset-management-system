import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { setStopLoss, checkStopLossAlerts } from './stopLossService';

const router = Router();

// All stop loss routes require authentication
router.use(authMiddleware);

// PUT /api/stoploss/set/:id — set stop loss price for a position
router.put('/set/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const positionId = parseInt(req.params.id as string);
    const userId = req.user!.id;
    const { stopLossPrice } = req.body;
    const result = setStopLoss(positionId, userId, stopLossPrice);
    res.json({ position: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/stoploss/check — check stop loss triggers for current user
router.get('/check', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const alerts = checkStopLossAlerts(userId);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

export default router;
