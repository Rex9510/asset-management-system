/**
 * Custom application error class with structured error information.
 * All API errors should use this class to ensure consistent error responses.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Convert to the unified error response format.
   */
  toJSON() {
    const error: { code: string; message: string; details?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) {
      error.details = this.details;
    }
    return { error };
  }
}

// Common error factory helpers
export const Errors = {
  badRequest: (message: string, details?: unknown) =>
    new AppError(400, 'BAD_REQUEST', message, details),

  unauthorized: (message = '未授权，请先登录') =>
    new AppError(401, 'UNAUTHORIZED', message),

  forbidden: (message = '无权限访问') =>
    new AppError(403, 'FORBIDDEN', message),

  notFound: (message = '资源不存在') =>
    new AppError(404, 'NOT_FOUND', message),

  conflict: (message: string, details?: unknown) =>
    new AppError(409, 'CONFLICT', message, details),

  internal: (message = '服务器内部错误') =>
    new AppError(500, 'INTERNAL_ERROR', message),
};
