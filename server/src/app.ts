import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './auth/authRoutes';
import positionRoutes from './positions/positionRoutes';
import marketRoutes from './market/marketRoutes';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/market', marketRoutes);

// Global error handling middleware (must be registered after all routes)
app.use(errorHandler);

export default app;
