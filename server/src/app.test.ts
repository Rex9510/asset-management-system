import request from 'supertest';
import app from './app';

describe('app', () => {
  it('returns 404 JSON for unknown GET under /api', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  });
});
