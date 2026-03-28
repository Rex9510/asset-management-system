import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getCurrentChainStatus } from './commodityChainService';

const router = Router();
router.use(authMiddleware);

// GET /api/chain/status
router.get('/status', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = getCurrentChainStatus();
    if (!data) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '暂无传导链数据' } });
      return;
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
