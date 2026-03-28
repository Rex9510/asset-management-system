/**
 * 沪深300成分股数据种子脚本
 * 从东方财富公开接口拉取沪深300成分股列表，写入 hs300_constituents 表
 * 
 * 用法: npx ts-node src/db/seedHS300.ts
 */
import axios from 'axios';
import { getDatabase, closeDatabase } from './connection';
import { initializeDatabase } from './init';

interface EastMoneyStock {
  f12: string; // 股票代码
  f14: string; // 股票名称
  f20: number; // 总市值
}

async function fetchHS300Constituents(): Promise<Array<{ code: string; name: string; weight: number }>> {
  const url = 'https://push2.eastmoney.com/api/qt/clist/get';
  const allStocks: EastMoneyStock[] = [];

  console.log('正在从东方财富拉取沪深300成分股数据...');

  for (let page = 1; page <= 4; page++) {
    const response = await axios.get(url, {
      params: {
        pn: page, pz: 100, po: 1, np: 1, fltt: 2, invt: 2,
        fs: 'b:BK0500+f:!50',
        fields: 'f12,f14,f20',
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://quote.eastmoney.com/',
      },
      timeout: 15000,
    });

    const diff = response.data?.data?.diff;
    if (!diff || diff.length === 0) break;
    allStocks.push(...diff);
    console.log(`  第${page}页: ${diff.length} 条`);
    if (diff.length < 100) break; // 最后一页
  }

  const totalMarketCap = allStocks.reduce((sum, s) => sum + (s.f20 || 0), 0);

  return allStocks.map((s) => {
    const code = s.f12;
    const fullCode = code.startsWith('6') ? `${code}.SH` : `${code}.SZ`;
    const weight = totalMarketCap > 0 ? parseFloat(((s.f20 / totalMarketCap) * 100).toFixed(4)) : 0;
    return { code: fullCode, name: s.f14, weight };
  });
}

async function seed() {
  try {
    const constituents = await fetchHS300Constituents();
    console.log(`成功获取 ${constituents.length} 只沪深300成分股`);

    const db = getDatabase();
    initializeDatabase(db);

    const insertStmt = db.prepare(
      `INSERT OR REPLACE INTO hs300_constituents (stock_code, stock_name, weight, updated_at) VALUES (?, ?, ?, datetime('now'))`
    );

    const insertMany = db.transaction((items: Array<{ code: string; name: string; weight: number }>) => {
      db.prepare('DELETE FROM hs300_constituents').run();
      for (const item of items) {
        insertStmt.run(item.code, item.name, item.weight);
      }
    });

    insertMany(constituents);
    console.log(`已写入 ${constituents.length} 条沪深300成分股数据到数据库`);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM hs300_constituents').get() as { cnt: number };
    console.log(`验证: hs300_constituents 表共 ${count.cnt} 条记录`);

    const sample = db.prepare('SELECT stock_code, stock_name, weight FROM hs300_constituents ORDER BY weight DESC LIMIT 5').all();
    console.log('权重前5:');
    sample.forEach((row: any) => {
      console.log(`  ${row.stock_code} ${row.stock_name} 权重: ${row.weight}%`);
    });

    closeDatabase();
    console.log('完成!');
  } catch (error: any) {
    console.error('种子脚本执行失败:', error.message);
    closeDatabase();
    process.exit(1);
  }
}

seed();
