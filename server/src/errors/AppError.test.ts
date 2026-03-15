import { AppError, Errors } from './AppError';

describe('AppError', () => {
  it('should create an error with all fields', () => {
    const err = new AppError(400, 'BAD_REQUEST', 'Invalid input', { field: 'name' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('Invalid input');
    expect(err.details).toEqual({ field: 'name' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('should serialize to unified error format', () => {
    const err = new AppError(404, 'NOT_FOUND', 'Resource not found');
    expect(err.toJSON()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
      },
    });
  });

  it('should include details in JSON when present', () => {
    const err = new AppError(400, 'BAD_REQUEST', 'Validation failed', ['field1']);
    expect(err.toJSON()).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Validation failed',
        details: ['field1'],
      },
    });
  });

  it('should omit details in JSON when undefined', () => {
    const err = new AppError(500, 'INTERNAL_ERROR', 'Server error');
    const json = err.toJSON();
    expect(json.error).not.toHaveProperty('details');
  });
});

describe('Errors factory helpers', () => {
  it('badRequest creates 400 error', () => {
    const err = Errors.badRequest('Bad input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('Bad input');
  });

  it('unauthorized creates 401 error with default message', () => {
    const err = Errors.unauthorized();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('未授权，请先登录');
  });

  it('forbidden creates 403 error', () => {
    const err = Errors.forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('notFound creates 404 error', () => {
    const err = Errors.notFound('User not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('User not found');
  });

  it('conflict creates 409 error', () => {
    const err = Errors.conflict('Username taken');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });

  it('internal creates 500 error', () => {
    const err = Errors.internal();
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('服务器内部错误');
  });
});
