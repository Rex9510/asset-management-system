
import dotenv from 'dotenv';
dotenv.config();

import { getDatabase, closeDatabase } from '../db/connection';
import { initializeDatabase } from '../db/init';
import { fetchAndSaveStockHistory } from '../market/historyService';

const stockCode = process.argv[2] || '600519';
const stockName = process.argv[3] || '贵州茅台';

console.log(`重新补全 ${stockName}(${stockCode}) 40年历史数据...`);

initializeDatabase();
const db = getDatabase();

async function run() {
  const count = await fetchAndSaveStockHistory(stockCode, 40, db);
  console.log(`完成！新增/更新 ${count} 条K线`);

  const result = db.prepare(`
    SELECT COUNT(*) as cnt, MIN(trade_date) as minDate, MAX(trade_date) as maxDate
    FROM market_history
    WHERE stock_code = ?
  `).get(stockCode) as any;

  console.log(`\n当前统计:`);
  console.log(`  K线条数: ${result.cnt}`);
  console.log(`  最早日期: ${result.minDate}`);
  console.log(`  最新日期: ${result.maxDate}`);
  const years = result.cnt / 252;
  console.log(`  约 ${years.toFixed(1)} 年数据`);

  closeDatabase();
}

run().catch(err => {
  console.error('失败:', err);
  closeDatabase();
  process.exit(1);
});
