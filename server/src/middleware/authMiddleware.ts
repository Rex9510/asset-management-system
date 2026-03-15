import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../auth/authService';
import { Errors } from '../errors/AppError';

/**
 * JWT authentication middleware.
 * Extracts token from Authorization header (Bearer <token>),
 * verifies it, and attaches user info to req.user.
 * Returns 401 for missing/invalid tokens.
 */
export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(Errors.unauthorized('未提供认证令牌'));
    return;
  }

  const token = authHeader.slice(7);

  try {
    const user = verifyToken(token);
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
