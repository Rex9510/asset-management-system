/**
 * 清除估值缓存并重新计算（持仓+关注中的股票）
 *
 * 使用：在项目 server 目录下执行
 *   npx ts-node src/scripts/refreshValuationCache.ts
 * 或：
 *   npm run valuation:refresh
 *
 * 依赖：环境变量 DB_PATH（可选，默认 data/app.db）
 */
import dotenv from 'dotenv';
dotenv.config();

import { getDatabase, closeDatabase } from '../db/connection';
import { initializeDatabase } from '../db/init';
import { clearValuationCache, batchUpdateValuations } from '../valuation/valuationService';

async function main() {
  initializeDatabase();
  const db = getDatabase();

  const removed = clearValuationCache(db);
  console.log(`已清除 valuation_cache：${removed} 条`);

  const result = await batchUpdateValuations(db, 500);
  console.log(
    `批量重算估值完成：共 ${result.total} 只，成功 ${result.success}，失败 ${result.failed}`
  );

  closeDatabase();
}

main().catch((err) => {
  console.error('执行失败:', err);
  closeDatabase();
  process.exit(1);
});
