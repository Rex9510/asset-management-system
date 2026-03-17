import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './auth/authRoutes';
import positionRoutes from './positions/positionRoutes';
import marketRoutes from './market/marketRoutes';
import indicatorRoutes from './indicators/indicatorRoutes';
import newsRoutes from './news/newsRoutes';
import analysisRoutes from './analysis/analysisRoutes';
import chatRoutes from './chat/chatRoutes';
import calmDownRoutes from './chat/calmDownRoutes';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/indicators', indicatorRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/calm-down', calmDownRoutes);

// Global error handling middleware (must be registered after all routes)
app.use(errorHandler);

export default app;
