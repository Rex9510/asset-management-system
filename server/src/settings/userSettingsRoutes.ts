import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getUserSettings, updateUserSettings } from './userSettingsService';

const router = Router();
router.use(authMiddleware);

// GET /api/settings
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const settings = getUserSettings(userId);
    res.json({
      aiModel: settings.aiModel,
      analysisFrequency: settings.analysisFrequency,
      riskPreference: settings.riskPreference,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings
router.put('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { aiModel, analysisFrequency, riskPreference } = req.body;
    const updated = updateUserSettings(userId, { aiModel, analysisFrequency, riskPreference });
    res.json({
      aiModel: updated.aiModel,
      analysisFrequency: updated.analysisFrequency,
      riskPreference: updated.riskPreference,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
