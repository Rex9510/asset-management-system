
/**
 * 测试新浪历史K线API
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { getMarketPrefix } from '../market/marketDataService';

const stockCode = '600519';

// 新浪历史K线API
// https://finance.sina.com.cn/stock/hd/
// API格式: http://finance.sina.com.cn/stock/quotes/history_kline.php?symbol=sh600519

export async function fetchKlineFromSina(stockCode: string): Promise<any[]> {
  const prefix = getMarketPrefix(stockCode);
  const symbol = `${prefix}${stockCode}`;

  // 新浪历史K线API
  const url = `http://api.finance.sina.com.cn/kline/get.php`;

  // 从上市日到今天
  const start = 20010827; // 贵州茅台上市日
  const end = new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate();

  const response = await axios.get(url, {
    params: {
      symbol,
      start,
      end,
      type: 'daily',
      _: Date.now(),
    },
    headers: {
      Referer: 'https://finance.sina.com.cn',
    },
    timeout: 30000,
  });

  console.log('Response:', response.data);
  return [];
}

fetchKlineFromSina(stockCode).catch(err => {
  console.error('Error:', err.message);
});
