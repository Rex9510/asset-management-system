import cors from 'cors';

/**
 * 生产环境收紧 CORS：仅允许 CORS_ORIGINS 中的 Origin（英文逗号分隔）。
 * 未配置且 NODE_ENV=production 时 origin=false（不向外域返回 ACAO），
 * 与前端、API 同域部署时浏览器同源请求不受影响。
 */
export function buildCorsMiddleware(): ReturnType<typeof cors> {
  if (process.env.NODE_ENV !== 'production') {
    return cors({ origin: true });
  }

  const raw = process.env.CORS_ORIGINS || '';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return cors({ origin: false });
  }

  return cors({
    origin: origins,
    credentials: true,
  });
}
