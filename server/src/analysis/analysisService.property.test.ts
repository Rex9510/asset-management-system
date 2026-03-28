/**
 * AI分析上下文完整性属性测试
 * Task 24.2
 */
import * as fc from 'fast-check';
import { buildAdditionalContextString, isCyclicalStock } from './analysisService';

// Feature: ai-investment-assistant-phase2, Property 33: AI分析上下文完整性
// 验证需求：1.5, 2.5, 3.5, 4.6, 11.4
test('AI请求上下文包含估值分位、轮动阶段、传导链状态、情绪指数、相关事件', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100 }),  // pePercentile
      fc.integer({ min: 0, max: 100 }),  // pbPercentile
      fc.constantFrom('low', 'fair', 'high'), // peZone
      fc.constantFrom('low', 'fair', 'high'), // pbZone
      fc.integer({ min: 1, max: 10 }),   // dataYears
      fc.constantFrom('P1', 'P2', 'P3'), // rotationPhase
      fc.constantFrom('科技成长', '周期品', '消费白酒'), // phaseLabel
      fc.integer({ min: 0, max: 100 }),  // sentimentScore
      fc.constantFrom('极度恐慌', '恐慌', '中性', '贪婪', '极度贪婪'), // sentimentLabel
      (pePercentile, pbPercentile, peZone, pbZone, dataYears, rotationPhase, phaseLabel, sentimentScore, sentimentLabel) => {
        const valuation = { pePercentile, pbPercentile, peZone, pbZone, dataYears };
        const rotation = { currentPhase: rotationPhase, phaseLabel };
        const chainStatus = {
          nodes: [
            { name: '黄金', shortName: 'Au', status: 'activated' as const, change10d: 5 },
            { name: '白银', shortName: 'Ag', status: 'transmitting' as const, change10d: 2 },
          ],
        };
        const sentiment = { score: sentimentScore, label: sentimentLabel };
        const events = [
          { name: '两会', windowStatus: 'before_build', windowLabel: '事件前·可建仓' },
        ];

        // Use a cyclical stock code to ensure chain status is included
        const contextStr = buildAdditionalContextString(
          '512400', // 有色ETF, cyclical
          valuation,
          rotation,
          chainStatus,
          sentiment,
          events,
        );

        // Verify all components present
        const hasValuation = contextStr.includes('估值分位');
        const hasRotation = contextStr.includes('轮动阶段');
        const hasChain = contextStr.includes('传导链');
        const hasSentiment = contextStr.includes('市场情绪');
        const hasEvents = contextStr.includes('近期事件');

        return hasValuation && hasRotation && hasChain && hasSentiment && hasEvents;
      }
    ),
    { numRuns: 50 }
  );
});

test('非周期品股票不注入传导链状态', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('600000', '000001', '601318'), // non-cyclical codes
      (stockCode) => {
        const contextStr = buildAdditionalContextString(
          stockCode,
          { pePercentile: 50, pbPercentile: 50, peZone: 'fair', pbZone: 'fair', dataYears: 10 },
          { currentPhase: 'P1', phaseLabel: '科技成长' },
          { nodes: [{ name: '黄金', shortName: 'Au', status: 'activated' as const, change10d: 5 }] },
          { score: 50, label: '中性' },
          [],
        );

        return !contextStr.includes('传导链');
      }
    ),
    { numRuns: 30 }
  );
});

test('isCyclicalStock 正确识别周期品ETF', () => {
  const cyclicalCodes = ['512400', '515220', '516020', '159886', '161129', '518880', '161226'];
  const nonCyclicalCodes = ['600000', '000001', '515000', '159928'];

  for (const code of cyclicalCodes) {
    expect(isCyclicalStock(code)).toBe(true);
  }
  for (const code of nonCyclicalCodes) {
    expect(isCyclicalStock(code)).toBe(false);
  }
});

test('无数据时上下文字符串为空', () => {
  const contextStr = buildAdditionalContextString(
    '600000',
    null,
    null,
    null,
    null,
    [],
  );
  expect(contextStr).toBe('');
});
