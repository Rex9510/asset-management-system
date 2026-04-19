import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getMonitors, addMonitor, deleteMonitor } from './cycleDetectorService';

const router = Router();
router.use(authMiddleware);

// GET /api/cycle/monitors
router.get('/monitors', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const monitors = getMonitors(userId);
    res.json({ monitors });
  } catch (err) {
    next(err);
  }
});

// POST /api/cycle/monitors
router.post('/monitors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { stockCode, stockName: bodyStockName } = req.body as {
      stockCode?: unknown;
      stockName?: unknown;
    };
    if (!stockCode || typeof stockCode !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请提供股票代码' } });
      return;
    }
    const preferredName =
      typeof bodyStockName === 'string' && bodyStockName.trim() ? bodyStockName.trim() : null;
    const monitor = await addMonitor(userId, stockCode.trim(), undefined, preferredName);
    res.status(201).json(monitor);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cycle/monitors/:id
router.delete('/monitors/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const monitorId = parseInt(req.params.id as string, 10);
    if (isNaN(monitorId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '无效的监控ID' } });
      return;
    }
    const deleted = deleteMonitor(userId, monitorId);
    if (!deleted) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '监控记录不存在' } });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
