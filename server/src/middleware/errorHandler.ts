import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

/**
 * Express global error handling middleware.
 * Catches all errors and returns a unified error response format:
 * { error: { code: string, message: string, details?: any } }
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle known AppError instances
  if (err instanceof AppError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Handle JSON parse errors (malformed request body)
  if (err.type === 'entity.parse.failed' || err.message?.includes('JSON')) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: '请求格式错误',
      },
    });
    return;
  }

  // Log unexpected errors
  console.error('Unexpected error:', err);

  // Return generic 500 for unknown errors
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    },
  });
}
