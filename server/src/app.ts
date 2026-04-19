import express from 'express';
import path from 'path';
import { buildCorsMiddleware } from './middleware/corsConfig';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './auth/authRoutes';
import positionRoutes from './positions/positionRoutes';
import marketRoutes from './market/marketRoutes';
import indicatorRoutes from './indicators/indicatorRoutes';
import newsRoutes from './news/newsRoutes';
import analysisRoutes from './analysis/analysisRoutes';
import chatRoutes from './chat/chatRoutes';
import calmDownRoutes from './chat/calmDownRoutes';
import messageRoutes from './messages/messageRoutes';
import valuationRoutes from './valuation/valuationRoutes';
import rotationRoutes from './rotation/rotationRoutes';
import deepAnalysisRoutes from './analysis/deepAnalysisRoutes';
import stopLossRoutes from './stoploss/stopLossRoutes';
import marketEnvRoutes from './marketenv/marketEnvRoutes';
import dailyPickTrackingRoutes from './dailypick/dailyPickTrackingRoutes';
import commodityChainRoutes from './chain/commodityChainRoutes';
import eventCalendarRoutes from './events/eventCalendarRoutes';
import cycleDetectorRoutes from './cycle/cycleDetectorRoutes';
import backtestRoutes from './backtest/backtestRoutes';
import sentimentRoutes from './sentiment/sentimentRoutes';
import concentrationRoutes from './concentration/concentrationRoutes';
import operationLogRoutes from './oplog/operationLogRoutes';
import notificationRoutes from './notification/notificationRoutes';
import snapshotRoutes from './snapshot/snapshotRoutes';
import userSettingsRoutes from './settings/userSettingsRoutes';

const app = express();

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.use(buildCorsMiddleware());
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
app.use('/api/messages', messageRoutes);
app.use('/api/valuation', valuationRoutes);
app.use('/api/rotation', rotationRoutes);
app.use('/api/analysis/deep', deepAnalysisRoutes);
app.use('/api/stoploss', stopLossRoutes);
app.use('/api/market-env', marketEnvRoutes);
app.use('/api/daily-pick', dailyPickTrackingRoutes);
app.use('/api/chain', commodityChainRoutes);
app.use('/api/events', eventCalendarRoutes);
app.use('/api/cycle', cycleDetectorRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/sentiment', sentimentRoutes);
app.use('/api/concentration', concentrationRoutes);
app.use('/api/oplog', operationLogRoutes);
app.use('/api/notification', notificationRoutes);
app.use('/api/snapshot', snapshotRoutes);
app.use('/api/settings', userSettingsRoutes);

// Serve static files from client build
// When running from server/dist, the path is ../../client/dist relative to dist folder
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// Serve index.html for all non-API routes (SPA client-side routing)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
    return;
  }
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: '接口不存在',
    },
  });
});

// Global error handling middleware (must be registered after all routes)
app.use(errorHandler);

export default app;
