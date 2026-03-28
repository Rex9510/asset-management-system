
import dotenv from 'dotenv';
dotenv.config();

import { getDatabase, closeDatabase } from '../db/connection';
import { initializeDatabase } from '../db/init';

const stockCode = process.argv[2] || '600519';

initializeDatabase();
const db = getDatabase();

const result = db.prepare(`
  SELECT COUNT(*) as cnt, MIN(trade_date) as minDate, MAX(trade_date) as maxDate
  FROM market_history
  WHERE stock_code = ?
`).get(stockCode) as any;

console.log(`${stockCode} 数据统计:`);
console.log(`  K线条数: ${result.cnt}`);
console.log(`  最早日期: ${result.minDate}`);
console.log(`  最新日期: ${result.maxDate}`);
const years = result.cnt / 252;
console.log(`  约 ${years.toFixed(1)} 年数据`);

closeDatabase();
