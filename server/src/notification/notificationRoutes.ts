import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getNotificationSettings, updateNotificationSettings } from './notificationService';

const router = Router();
router.use(authMiddleware);

// GET /api/notification/settings
router.get('/settings', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const settings = getNotificationSettings(userId);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// PUT /api/notification/settings
router.put('/settings', (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { settings } = req.body;
    if (!Array.isArray(settings)) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'settings must be an array' } });
      return;
    }
    updateNotificationSettings(userId, settings);
    const updated = getNotificationSettings(userId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
