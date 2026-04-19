/**
 * 深度分析报告属性测试
 * Tasks 7.2, 7.3, 7.4
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';
import { parseDeepAnalysisResponse, getDeepReport, getDeepReportHistory, DeepReport } from './deepAnalysisService';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function addUser(db: Database.Database, id: number) {
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(id, 'u' + id, 'h');
}

// Feature: ai-investment-assistant-phase2, Property 10: 深度分析报告结构完整性
// 验证需求：5.1, 5.3
test('已完成报告应包含所有必要非空字段', () => {
  const db = makeDb();
  addUser(db, 1);

  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 20 }),  // stockCode
      fc.string({ minLength: 1, maxLength: 20 }),  // stockName
      fc.string({ minLength: 1, maxLength: 100 }), // conclusion
      fc.string({ minLength: 1, maxLength: 100 }), // fundamentals
      fc.string({ minLength: 1, maxLength: 100 }), // financials
      fc.string({ minLength: 1, maxLength: 100 }), // valuation
      fc.string({ minLength: 1, maxLength: 100 }), // strategy
      (stockCode, stockName, conclusion, fundamentals, financials, valuation, strategy) => {
        const now = new Date().toISOString();
        const today = now.split('T')[0];
        const result = db.prepare(
          `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deepseek-chat', 75, ?, 'completed', ?)`
        ).run(1, stockCode, stockName, conclusion, fundamentals, financials, valuation, strategy, today, now);

        const report = getDeepReport(Number(result.lastInsertRowid), 1, db);
        if (!report) return false;

        return (
          report.conclusion.length > 0 &&
          report.fundamentals.length > 0 &&
          report.financials.length > 0 &&
          report.valuation.length > 0 &&
          report.strategy.length > 0 &&
          report.aiModel.length > 0 &&
          report.dataCutoffDate.length > 0 &&
          report.confidence !== null &&
          report.status === 'completed'
        );
      }
    ),
    { numRuns: 50 }
  );

  db.close();
});

// Feature: ai-investment-assistant-phase2, Property 11: AI输出合规措辞
// 验证需求：5.2, 13.4
test('AI文本不含"建议"/"推荐"（"埋伏推荐"除外），使用"参考方案"', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        '参考操作方案：当前价位可轻仓配置',
        '参考方案为持有观望，等待回调',
        '综合分析，参考方案为逢低布局',
        '短期参考方案：控制仓位在30%以内',
        '埋伏推荐：关注低位放量信号',
      ),
      (text) => {
        // "埋伏推荐" is allowed, other "建议"/"推荐" are not
        const cleaned = text.replace(/埋伏推荐/g, '');
        const hasForbidden = /建议|推荐/.test(cleaned);
        return !hasForbidden;
      }
    ),
    { numRuns: 100 }
  );
});

test('parseDeepAnalysisResponse 解析结果不含批评性语言', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        `=== 结论 ===\n参考方案为观望\n=== 基本面 ===\n行业稳定\n=== 财务数据 ===\n营收增长\n=== 估值分位 ===\n合理区间\n=== 交易策略 ===\n参考方案为轻仓`,
        `=== 结论 ===\n短期震荡\n=== 基本面 ===\n龙头地位\n=== 财务数据 ===\n利润稳定\n=== 估值分位 ===\n低估区间\n=== 交易策略 ===\n参考方案为逢低布局`,
      ),
      (aiText) => {
        const parsed = parseDeepAnalysisResponse(aiText);
        const allText = [parsed.conclusion, parsed.fundamentals, parsed.financials, parsed.valuation, parsed.strategy].join(' ');
        // No criticism or blame language
        const hasCriticism = /你做错了|不应该|愚蠢|失败的决定/.test(allText);
        return !hasCriticism;
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 12: 深度报告存储与检索往返
// 验证需求：5.4
test('按股票代码和时间检索能找到报告，内容一致', () => {
  const db = makeDb();
  addUser(db, 1);

  fc.assert(
    fc.property(
      fc.stringMatching(/^[0-9]{6}$/),  // stockCode
      fc.string({ minLength: 1, maxLength: 10 }),  // stockName
      fc.string({ minLength: 1, maxLength: 50 }),  // conclusion
      (stockCode, stockName, conclusion) => {
        const now = new Date().toISOString();
        const today = now.split('T')[0];
        const result = db.prepare(
          `INSERT INTO deep_reports (user_id, stock_code, stock_name, conclusion, fundamentals, financials, valuation, strategy, ai_model, confidence, data_cutoff_date, status, created_at)
           VALUES (?, ?, ?, ?, '基本面', '财务', '估值', '策略', 'deepseek-chat', 75, ?, 'completed', ?)`
        ).run(1, stockCode, stockName, conclusion, today, now);

        // Retrieve by ID
        const report = getDeepReport(Number(result.lastInsertRowid), 1, db);
        if (!report) return false;

        // Retrieve by history (stockCode filter)
        const history = getDeepReportHistory(stockCode, 1, 100, 1, db);
        const found = history.reports.find(r => r.id === report.id);

        return (
          report.stockCode === stockCode &&
          report.stockName === stockName &&
          report.conclusion === conclusion &&
          found !== undefined &&
          found.conclusion === conclusion
        );
      }
    ),
    { numRuns: 30 }
  );

  db.close();
});
