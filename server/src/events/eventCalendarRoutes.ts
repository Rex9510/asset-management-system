import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getEvents, createEvent, updateEvent, deleteEvent } from './eventCalendarService';

const router = Router();
router.use(authMiddleware);

// GET /api/events?days=7
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;
    const events = getEvents(days);
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// POST /api/events
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, eventDate, eventEndDate, category, relatedSectors, beforeDays, afterDays, tip } = req.body;
    if (!name || !eventDate || !category || !relatedSectors || beforeDays == null || afterDays == null) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '缺少必填字段' } });
      return;
    }
    const event = createEvent({ name, eventDate, eventEndDate, category, relatedSectors, beforeDays, afterDays, tip });
    res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
});

// PUT /api/events/:id
router.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const updated = updateEvent(id, req.body);
    if (!updated) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '事件不存在' } });
      return;
    }
    res.json({ event: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:id
router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const deleted = deleteEvent(id);
    if (!deleted) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '事件不存在' } });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
