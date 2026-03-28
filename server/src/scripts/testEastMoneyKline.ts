
/**
 * 测试东方财富历史K线API
 * 东方财富API: http://push2his.eastmoney.com/api/qt/stock/kline/get
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { getMarketPrefix } from '../market/marketDataService';

const stockCode = '600519';

export async function fetchKlineFromEastMoney(
  stockCode: string,
  yearsBack: number = 25
): Promise<any[]> {
  const prefix = getMarketPrefix(stockCode);
  // secid: 1 for sh, 0 for sz
  const secid = prefix === 'sh' ? `1.${stockCode}` : `0.${stockCode}`;

  // 东方财富API参数说明:
  // secid: 市场.代码
  // s: 股票代码带前缀
  // ktm: 1 日K
  // beg: 开始日期 格式19900101
  // end: 结束日期 格式20251231
  const begDate = 19900101;
  const today = new Date();
  const endDate = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();

  const url = 'http://push2his.eastmoney.com/api/qt/stock/kline/get';

  const response = await axios.get(url, {
    params: {
      secid,
      s: `${prefix}${stockCode}`,
      period: 1, // 日K
      beg: begDate,
      end: endDate,
      cols: 'f1,f2,f3,f4,f5,f6', // f1日期,f2开盘,f3收盘,f4最高,f5最低,f6成交量
    },
    headers: {
      Referer: 'https://quote.eastmoney.com/',
    },
    timeout: 30000,
  });

  const data = response.data;
  console.log('Response keys:', Object.keys(data));
  console.log('Data:', JSON.stringify(data, null, 2));
  if (!data || !data.data || !data.data.klines) {
    console.log('No data returned');
    return [];
  }

  // klines 是每行用空格分隔的字符串数组
  // 每行格式: "2023-01-02 10.50 10.80 10.90 10.40 123456"
  const klines: string[] = data.data.klines;
  console.log(`API返回K线条数: ${klines.length}`);

  const rows = klines.map(line => {
    const parts = line.split(',');
    const [date, open, close, high, low, volume] = parts;
    return {
      date,
      open: parseFloat(open),
      close: parseFloat(close),
      high: parseFloat(high),
      low: parseFloat(low),
      volume: parseFloat(volume),
    };
  }).filter(r => r.open > 0);

  console.log(`第一条日期: ${rows[0]?.date}`);
  console.log(`最后一条日期: ${rows[rows.length - 1]?.date}`);
  console.log(`有效K线: ${rows.length}条`);
  const years = rows.length / 252;
  console.log(`约 ${years.toFixed(1)} 年数据`);

  return rows;
}

// Test
fetchKlineFromEastMoney(stockCode, 25).catch(err => {
  console.error('错误:', err.message);
});
