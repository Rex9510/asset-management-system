import { Router, Request, Response, NextFunction } from 'express';
import { register, login, blacklistToken } from './authService';
import { authMiddleware } from '../middleware/authMiddleware';
import { loginIpLimiter, registerIpLimiter } from '../middleware/rateLimits';

const router = Router();

router.post('/register', registerIpLimiter, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password, agreedTerms } = req.body;
    const result = register(username, password, !!agreedTerms);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginIpLimiter, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password, agreedTerms } = req.body;
    const result = login(username, password, !!agreedTerms);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authMiddleware, (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    blacklistToken(token);
  }
  res.json({ message: '已退出登录' });
});

export default router;
