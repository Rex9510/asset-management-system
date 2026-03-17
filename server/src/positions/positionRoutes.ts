import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  getPositions,
  createPosition,
  updatePosition,
  deletePosition,
  PositionType,
} from './positionService';

const router = Router();

// All position routes require authentication
router.use(authMiddleware);

// GET /api/positions - Get all positions for the authenticated user
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const type = req.query.type as PositionType | undefined;
    if (type && type !== 'holding' && type !== 'watching') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '无效的类型，可选值：holding, watching' } });
      return;
    }
    const positions = getPositions(userId, undefined, type);
    res.json({ positions });
  } catch (err) {
    next(err);
  }
});

// POST /api/positions - Create a new position
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { stockCode, stockName, costPrice, shares, buyDate, positionType } = req.body;
    const position = createPosition(userId, { stockCode, stockName, costPrice, shares, buyDate, positionType });
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
