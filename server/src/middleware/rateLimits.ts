import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

const isTest = process.env.NODE_ENV === 'test';

/** 测试环境放宽，避免单测连打触发 429 */
const testLimit = 100_000;

function rate429Message(msg: string) {
  return { error: { code: 'RATE_LIMITED', message: msg } };
}

/** 登录：按 IP，防撞库/爆破（与账户级锁定互补） */
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? testLimit : 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: rate429Message('登录尝试过于频繁，请 15 分钟后再试'),
});

/** 注册：按 IP，防批量注册 */
export const registerIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: isTest ? testLimit : 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: rate429Message('注册请求过于频繁，请稍后再试'),
});

/** 与 ipKeyGenerator 组合，满足 IPv6 下 key 语义校验（见 express-rate-limit 文档） */
function userOrIpKey(req: Request): string {
  const ip = req.ip ?? '127.0.0.1';
  const ipKey = ipKeyGenerator(ip);
  if (req.user?.id != null) return `uid:${req.user.id}:${ipKey}`;
  return ipKey;
}

/** 对话发消息：按用户，控 AI 费用 */
export const chatSendUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? testLimit : 36,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: rate429Message('聊天发送过于频繁，请稍后再试'),
});

/** 冷静评估：按用户 */
export const calmDownEvaluateUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? testLimit : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: rate429Message('评估请求过于频繁，请稍后再试'),
});

/** 手动触发阶段分析：按用户 */
export const analysisTriggerUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? testLimit : 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: rate429Message('分析触发过于频繁，请稍后再试'),
});

/** 深度报告生成（POST）：按用户，单报告成本高 */
export const deepReportPostUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? testLimit : 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: rate429Message('深度报告生成过于频繁，请稍后再试'),
});
