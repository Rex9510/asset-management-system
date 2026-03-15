import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  getPositions,
  createPosition,
  updatePosition,
  deletePosition,
} from './positionService';

const router = Router();

// All position routes require authentication
router.use(authMiddleware);

// GET /api/positions - Get all positions for the authenticated user
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const positions = getPositions(userId);
    res.json({ positions });
  } catch (err) {
    next(err);
  }
});

// POST /api/positions - Create a new position
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { stockCode, stockName, costPrice, shares, buyDate } = req.body;
    const position = createPosition(userId, { stockCode, stockName, costPrice, shares, buyDate });
    res.status(201).json({ position });
  } catch (err) {
    next(err);
  }
});

// PUT /api/positions/:id - Update a position
router.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '无效的持仓ID' } });
      return;
    }
    const { costPrice, shares } = req.body;
    const position = updatePosition(id, userId, { costPrice, shares });
    res.json({ position });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/positions/:id - Delete a position
router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '无效的持仓ID' } });
      return;
    }
    deletePosition(id, userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
