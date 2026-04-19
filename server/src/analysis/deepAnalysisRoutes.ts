import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { deepReportPostUserLimiter } from '../middleware/rateLimits';
import { generateDeepReportAsync, getDeepReport, getDeepReportHistory } from './deepAnalysisService';

const router = Router();
router.use(authMiddleware);

// POST /api/analysis/deep/:stockCode — start async generation
router.post('/:stockCode', deepReportPostUserLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.params.stockCode as string;
    const userId = req.user!.id;
    const result = await generateDeepReportAsync(stockCode, userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/analysis/deep/history — paginated history
router.get('/history', (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.query.stockCode as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = getDeepReportHistory(stockCode, page, limit, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/analysis/deep/:reportId — get specific report (for polling)
// IMPORTANT: This route must come AFTER /history to avoid matching "history" as reportId
router.get('/:reportId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const reportId = parseInt(req.params.reportId as string);
    if (isNaN(reportId)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '无效的报告ID' } });
      return;
    }
    const report = getDeepReport(reportId, req.user!.id);
    if (!report) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '报告不存在' } });
      return;
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
