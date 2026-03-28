
import dotenv from 'dotenv';
dotenv.config();

import { fetchKlineFromTencent } from '../market/historyService';

const stockCode = '600519';

async function testEarlySegments() {
  // 贵州茅台2001年8月上市，测试 2001-2016
  const tests = [
    ['1990-01-01', '2000-12-31'],
    ['2001-01-01', '2005-12-31'],
    ['2006-01-01', '2010-12-31'],
    ['2011-01-01', '2015-12-31'],
    ['2016-01-01', '2020-12-31'],
  ];

  for (const [start, end] of tests) {
    console.log(`\n测试拉取 ${start} 到 ${end}...`);
    try {
      const rows = await fetchKlineFromTencent(stockCode, start, end);
      console.log(`  获取到 ${rows.length} 条K线`);
      if (rows.length > 0) {
        console.log(`  第一条: ${rows[0].tradeDate}, 最后一条: ${rows[rows.length - 1].tradeDate}`);
      }
    } catch (err) {
      console.error(`  失败: ${(err as Error).message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

testEarlySegments();
