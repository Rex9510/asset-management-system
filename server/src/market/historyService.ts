/**
 * 历史K线数据拉取服务
 * 从腾讯财经拉取沪深300成分股的历史日K线数据，写入 market_history 表
 * 拉完后自动计算技术指标
 *
 * 独立运行: npx ts-node src/market/historyService.ts [年数，默认10]
 * 也可被 scheduler 调用做每日增量更新
 */
import axios from 'axios';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection';
import { getMarketPrefix } from './marketDataService';
import { calculateAndCacheIndicators } from '../indicators/indicatorService';

export interface KlineRow {
  tradeDate: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/**
 * 从腾讯财经拉取历史日K线（前复权）
 * 腾讯API单次最多返回约640条，所以10年数据需要分段拉取
 */
export async function fetchKlineFromTencent(
  stockCode: string,
  startDate: string,
  endDate: string
): Promise<KlineRow[]> {
  const prefix = getMarketPrefix(stockCode);
  const symbol = `${prefix}${stockCode}`;

  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`;

  // 带重试的请求（最多3次）
  let response: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await axios.get(url, {
        params: {
          param: `${symbol},day,${startDate},${endDate},600,qfq`,
        },
        timeout: 15000,
      });
      break;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  const data = response?.data?.data?.[symbol];
  const qfqday: string[][] = data?.qfqday || data?.day || [];

  // 每条格式: ["2024-01-02", "10.50", "10.80", "10.90", "10.40", "123456"]
  // 字段: 日期, 开盘, 收盘, 最高, 最低, 成交量
  const rows: KlineRow[] = [];
  for (const item of qfqday) {
    if (!Array.isArray(item) || item.length < 6) continue;
    const open = parseFloat(item[1]);
    const close = parseFloat(item[2]);
    const high = parseFloat(item[3]);
    const low = parseFloat(item[4]);
    const volume = parseFloat(item[5]);
    // 跳过前复权导致的负数价格
    if (open <= 0 || close <= 0 || high <= 0 || low <= 0) continue;
    rows.push({
      tradeDate: item[0],
      open, close, high, low, volume,
    });
  }
  return rows;
}

/**
 * 分段拉取多年历史K线（每段2年，腾讯API单次最多~640条）
 */
export async function fetchKlineMultiSegment(
  stockCode: string,
  yearsBack: number = 10
): Promise<KlineRow[]> {
  const now = new Date();
  const allRows: KlineRow[] = [];
  const seenDates = new Set<string>();

  // 每段2年，从最近往前拉
  const segmentYears = 2;
  const segments = Math.ceil(yearsBack / segmentYears);

  for (let i = 0; i < segments; i++) {
    const endYear = now.getFullYear() - i * segmentYears;
    const startYear = endYear - segmentYears;
    const startDate = `${startYear}-01-01`;
    const endDate = i === 0
      ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      : `${endYear}-12-31`;

    try {
      const rows = await fetchKlineFromTencent(stockCode, startDate, endDate);
      for (const r of rows) {
        if (!seenDates.has(r.tradeDate)) {
          seenDates.add(r.tradeDate);
          allRows.push(r);
        }
      }
    } catch {
      // 某段失败不影响其他段
    }

    // 段间延迟
    if (i < segments - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // 按日期排序
  allRows.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  return allRows;
}

/**
 * 将K线数据写入 market_history 表（INSERT OR REPLACE 去重）
 */
export function saveKlineToDb(stockCode: string, rows: KlineRow[], db?: Database.Database): number {
  const database = db || getDatabase();
  const stmt = database.prepare(
    `INSERT OR REPLACE INTO market_history (stock_code, trade_date, open_price, close_price, high_price, low_price, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertAll = database.transaction((data: KlineRow[]) => {
    let count = 0;
    for (const r of data) {
      stmt.run(stockCode, r.tradeDate, r.open, r.close, r.high, r.low, r.volume);
      count++;
    }
    return count;
  });

  return insertAll(rows);
}

/**
 * 拉取单只股票的历史K线并写入DB，然后计算技术指标
 * @param fullStockCode 带后缀的代码如 600519.SH，或纯6位数字
 */
export async function fetchAndSaveStockHistory(
  fullStockCode: string,
  yearsBack: number = 40,
  db?: Database.Database
): Promise<number> {
  const pureCode = fullStockCode.replace(/\.\w+$/, '');
  const rows = await fetchKlineMultiSegment(pureCode, yearsBack);
  if (rows.length === 0) return 0;

  const saved = saveKlineToDb(pureCode, rows, db);

  // 计算并缓存技术指标
  try {
    calculateAndCacheIndicators(pureCode, db);
  } catch {
    // 技术指标计算失败不影响K线数据保存
  }

  return saved;
}

/**
 * 批量拉取所有沪深300成分股的历史K线
 * @param yearsBack 拉取多少年（默认10）
 * @param delayMs 每只股票之间的延迟毫秒数（默认500ms）
 */
export async function fetchAllHS300History(
  yearsBack: number = 10,
  delayMs: number = 500,
  db?: Database.Database
): Promise<{ total: number; success: number; failed: number }> {
  const database = db || getDatabase();

  const constituents = database
    .prepare('SELECT stock_code, stock_name FROM hs300_constituents')
    .all() as { stock_code: string; stock_name: string }[];

  if (constituents.length === 0) {
    console.log('hs300_constituents 表为空，请先运行 seedHS300');
    return { total: 0, success: 0, failed: 0 };
  }

  console.log(`开始拉取 ${constituents.length} 只沪深300成分股的${yearsBack}年历史K线数据...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < constituents.length; i++) {
    const stock = constituents[i];
    try {
      const count = await fetchAndSaveStockHistory(stock.stock_code, yearsBack, database);
      success++;
      if ((i + 1) % 10 === 0 || i === constituents.length - 1) {
        console.log(`  进度: ${i + 1}/${constituents.length} | ${stock.stock_name}(${stock.stock_code}) ${count}条K线`);
      }
    } catch (err: any) {
      failed++;
      console.error(`  失败: ${stock.stock_name}(${stock.stock_code}) - ${err.message}`);
    }

    // 延迟防止被封
    if (i < constituents.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`完成! 成功: ${success}, 失败: ${failed}, 总计: ${constituents.length}`);
  return { total: constituents.length, success, failed };
}

/**
 * 确保某只股票有历史K线数据。如果没有，拉取10年；如果有但不是最新的，补充缺失日期。
 * 用于：添加持仓/关注时自动触发
 * @returns 新增的K线条数
 */
export async function ensureStockHistory(
  stockCode: string,
  db?: Database.Database
): Promise<number> {
  const database = db || getDatabase();
  const pureCode = stockCode.replace(/\.\w+$/, '');

  // 查看该股票已有的最新和最早日期
  const latest = database
    .prepare('SELECT MAX(trade_date) as maxDate, MIN(trade_date) as minDate, COUNT(*) as cnt FROM market_history WHERE stock_code = ?')
    .get(pureCode) as { maxDate: string | null; minDate: string | null; cnt: number };

  if (!latest.maxDate || latest.cnt === 0) {
    // 没有任何数据，拉取全部历史（最多40年，覆盖A股上市以来所有数据）
    return await fetchAndSaveStockHistory(pureCode, 40, database);
  }

  // 有数据，检查是否需要补充
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const latestDate = latest.maxDate;

  // 如果最新数据就是今天或昨天（非交易日可能没数据），不需要更新
  const daysDiff = Math.floor((new Date(todayStr).getTime() - new Date(latestDate).getTime()) / 86400000);
  if (daysDiff <= 1) return 0;

  // 补充从最新日期到今天的数据
  try {
    const rows = await fetchKlineFromTencent(pureCode, latestDate, todayStr);
    if (rows.length > 0) {
      const saved = saveKlineToDb(pureCode, rows, database);
      try { calculateAndCacheIndicators(pureCode, database); } catch { /* ignore */ }
      return saved;
    }
  } catch {
    // 补充失败不报错
  }

  return 0;
}

/**
 * 确保所有用户持仓/关注的股票都有历史数据
 * 用于：服务启动时调用
 */
export async function ensureAllUserStocksHistory(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();

  // 获取所有用户持仓/关注的股票（去重）
  const stocks = database
    .prepare('SELECT DISTINCT stock_code, stock_name FROM positions')
    .all() as { stock_code: string; stock_name: string }[];

  if (stocks.length === 0) return;

  console.log(`检查 ${stocks.length} 只用户持仓/关注股票的历史数据...`);

  let updated = 0;
  for (const stock of stocks) {
    try {
      const count = await ensureStockHistory(stock.stock_code, database);
      if (count > 0) {
        updated++;
        console.log(`  补充: ${stock.stock_name}(${stock.stock_code}) +${count}条K线`);
      }
    } catch {
      // 单只失败不影响其他
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`用户持仓股票历史数据检查完成，更新了 ${updated} 只`);
}

/**
 * 每日增量更新：更新所有沪深300成分股 + 用户持仓股票的最新K线
 * 自动检测缺失日期并补充（如果错过了某天，会从上次最新日期开始补拉）
 * 用于 scheduler 每天收盘后调用
 */
export async function dailyHistoryUpdate(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();

  // 收集需要更新的所有股票代码（HS300 + 用户持仓，去重）
  const hs300 = database
    .prepare('SELECT stock_code, stock_name FROM hs300_constituents')
    .all() as { stock_code: string; stock_name: string }[];

  const userStocks = database
    .prepare('SELECT DISTINCT stock_code, stock_name FROM positions')
    .all() as { stock_code: string; stock_name: string }[];

  const stockMap = new Map<string, string>();
  for (const s of hs300) stockMap.set(s.stock_code, s.stock_name);
  for (const s of userStocks) stockMap.set(s.stock_code, s.stock_name);

  // 商品传导链ETF
  const chainETFs = [
    ['518880', '黄金ETF'], ['161226', '白银ETF'], ['512400', '有色ETF'],
    ['515220', '煤炭ETF'], ['516020', '化工ETF'], ['159886', '橡胶ETF'], ['161129', '原油ETF'],
  ];
  for (const [code, name] of chainETFs) stockMap.set(code, name);

  // 周期监控标的
  const cycleStocks = database.prepare(
    'SELECT DISTINCT stock_code, stock_name FROM cycle_monitors'
  ).all() as { stock_code: string; stock_name: string }[];
  for (const s of cycleStocks) stockMap.set(s.stock_code, s.stock_name);

  const allStocks = Array.from(stockMap.entries()).map(([code, name]) => ({ stock_code: code, stock_name: name }));

  if (allStocks.length === 0) return;

  console.log(`每日增量更新: ${allStocks.length} 只股票（HS300: ${hs300.length}, 用户持仓: ${userStocks.length}）...`);

  let success = 0;
  for (const stock of allStocks) {
    try {
      await ensureStockHistory(stock.stock_code, database);
      success++;
    } catch {
      // 单只失败不影响其他
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`每日增量更新完成: ${success}/${allStocks.length}`);
}

/**
 * 启动时确保所有特殊股票代码（商品传导链ETF、周期监控标的）有足够历史数据。
 * 这些代码不在用户持仓中，但服务需要它们的K线数据来计算。
 */
export async function ensureSpecialStocksHistory(db?: Database.Database): Promise<void> {
  const database = db || getDatabase();

  // 商品传导链ETF代码
  const chainETFs = [
    { code: '518880', name: '黄金ETF' },
    { code: '161226', name: '白银ETF' },
    { code: '512400', name: '有色ETF' },
    { code: '515220', name: '煤炭ETF' },
    { code: '516020', name: '化工ETF' },
    { code: '159886', name: '橡胶ETF' },
    { code: '161129', name: '原油ETF' },
  ];

  // 周期监控中的股票
  const cycleStocks = database.prepare(
    'SELECT DISTINCT stock_code, stock_name FROM cycle_monitors'
  ).all() as { stock_code: string; stock_name: string }[];

  const stockMap = new Map<string, string>();
  for (const e of chainETFs) stockMap.set(e.code, e.name);
  for (const s of cycleStocks) stockMap.set(s.stock_code, s.stock_name);

  const allStocks = Array.from(stockMap.entries());
  if (allStocks.length === 0) return;

  console.log(`检查 ${allStocks.length} 只特殊标的（ETF+周期监控）历史数据...`);

  let updated = 0;
  for (const [code, name] of allStocks) {
    try {
      const count = await ensureStockHistory(code, database);
      if (count > 0) {
        updated++;
        console.log(`  补充: ${name}(${code}) +${count}条K线`);
      }
    } catch {
      // 单只失败不影响其他
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`特殊标的历史数据检查完成，更新了 ${updated} 只`);
}

// --- 独立运行入口 ---
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
  const { initializeDatabase } = require('../db/init');
  const { closeDatabase } = require('../db/connection');

  initializeDatabase();

  const yearsArg = parseInt(process.argv[2] || '40', 10);
  console.log(`拉取最近 ${yearsArg} 年的历史K线数据`);

  fetchAllHS300History(yearsArg).then((result) => {
    console.log(`总计: ${result.total}, 成功: ${result.success}, 失败: ${result.failed}`);

    const db = getDatabase();
    const histCount = db.prepare('SELECT COUNT(*) as cnt FROM market_history').get() as { cnt: number };
    const indCount = db.prepare('SELECT COUNT(*) as cnt FROM technical_indicators').get() as { cnt: number };
    console.log(`market_history 表: ${histCount.cnt} 条记录`);
    console.log(`technical_indicators 表: ${indCount.cnt} 条记录`);

    closeDatabase();
  }).catch((err) => {
    console.error('执行失败:', err);
    closeDatabase();
    process.exit(1);
  });
}
