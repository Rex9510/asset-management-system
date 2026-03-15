import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getQuote, MarketQuote } from './marketDataService';
import { getDatabase } from '../db/connection';

const SSE_POLL_INTERVAL_MS = 5000; // 5 seconds polling interval (within 3-5s range)

const router = Router();

// All market routes require authentication
router.use(authMiddleware);

// GET /api/market/quote/:code - Get a single stock quote
router.get('/quote/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCode = req.params.code as string;
    const quote = await getQuote(stockCode);
    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/market/sse - Server-Sent Events endpoint for real-time market data push.
 *
 * Pushes market quotes for the authenticated user's positions at 3-5 second intervals.
 * Only fetches quotes for stocks the user currently holds.
 * Connection is cleaned up when the client disconnects (e.g., user leaves the page).
 *
 * Client-side reconnection strategy (documented for frontend implementation):
 * - Max 3 retries on disconnect
 * - Retry intervals: 1s, 3s, 5s (incrementing)
 *
 * Requirements: 2.1, 2.5, 2.6
 */
router.get('/sse', (req: Request, res: Response) => {
  const userId = req.user!.id;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering for SSE
  res.flushHeaders();

  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function pushQuotes(): Promise<void> {
    try {
      const db = getDatabase();
      const rows = db
        .prepare('SELECT DISTINCT stock_code FROM positions WHERE user_id = ?')
        .all(userId) as { stock_code: string }[];

      if (rows.length === 0) {
        res.write(`event: quotes\ndata: ${JSON.stringify({ quotes: [] })}\n\n`);
        return;
      }

      const quotes: MarketQuote[] = [];
      for (const row of rows) {
        try {
          const quote = await getQuote(row.stock_code);
          quotes.push(quote);
        } catch {
          // Skip individual stock failures, continue with others
        }
      }

      res.write(`event: quotes\ndata: ${JSON.stringify({ quotes })}\n\n`);
    } catch {
      // If DB or other critical error, send error event
      res.write(`event: error\ndata: ${JSON.stringify({ message: '行情数据获取失败' })}\n\n`);
    }
  }

  // Send initial data immediately
  pushQuotes();

  // Set up polling interval
  intervalId = setInterval(pushQuotes, SSE_POLL_INTERVAL_MS);

  // Clean up on client disconnect
  req.on('close', () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
});

export default router;
