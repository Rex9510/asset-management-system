import express from 'express';
import request from 'supertest';
import { AppError, Errors } from '../errors/AppError';
import { errorHandler } from './errorHandler';

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Route that throws AppError
  app.get('/app-error', (_req, res, next) => {
    next(Errors.notFound('资源不存在'));
  });

  // Route that throws AppError with details
  app.post('/validation-error', (_req, res, next) => {
    next(Errors.badRequest('参数校验失败', { field: 'stockCode', reason: '无效的股票代码' }));
  });

  // Route that throws unexpected error
  app.get('/unexpected-error', () => {
    throw new Error('Something went wrong');
  });

  // Route that throws 401
  app.get('/unauthorized', (_req, res, next) => {
    next(Errors.unauthorized());
  });

  app.use(errorHandler);
  return app;
}

describe('errorHandler middleware', () => {
  const app = createTestApp();

  it('should return unified error format for AppError', async () => {
    const res = await request(app).get('/app-error');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: '资源不存在',
      },
    });
  });

  it('should include details when present', async () => {
    const res = await request(app).post('/validation-error').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: '参数校验失败',
        details: { field: 'stockCode', reason: '无效的股票代码' },
      },
    });
  });

  it('should return 500 for unexpected errors', async () => {
    const res = await request(app).get('/unexpected-error');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误',
      },
    });
  });

  it('should return 401 for unauthorized errors', async () => {
    const res = await request(app).get('/unauthorized');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: '未授权，请先登录',
      },
    });
  });

  it('should handle malformed JSON body', async () => {
    const res = await request(app)
      .post('/validation-error')
      .set('Content-Type', 'application/json')
      .send('{ invalid json }');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
