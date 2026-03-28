import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getCurrentMarketEnv } from './marketEnvService';

const router = Router();
router.use(authMiddleware);

// GET /api/market-env/current
router.get('/current', (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = getCurrentMarketEnv();
    if (!data) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '暂无大盘环境数据' } });
      return;
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
