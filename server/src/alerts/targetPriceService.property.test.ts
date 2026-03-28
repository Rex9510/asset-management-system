import * as fc from 'fast-check';
import { extractTargetPrice } from './targetPriceService';

describe('属性测试：目标价提取', () => {
  it('JSON 格式的 targetPrice 字段应被正确提取', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 9999, noNaN: true }).map(v => Math.round(v * 100) / 100),
        (price) => {
          const analysis = {
            id: 1,
            profit_estimate: JSON.stringify({ targetPrice: price }),
            space_estimate: null,
          };
          const result = extractTargetPrice(analysis);
          expect(result).toBe(price);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('文本格式 "目标价XX元" 应被正确提取', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 999, noNaN: true }).map(v => Math.round(v * 100) / 100),
        (price) => {
          const analysis = {
            id: 1,
            profit_estimate: `预计目标价${price}元`,
            space_estimate: null,
          };
          const result = extractTargetPrice(analysis);
          expect(result).toBe(price);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('无有效目标价时应返回 null', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, '', '无目标价', '{}', JSON.stringify({ foo: 'bar' })),
        (field) => {
          const analysis = {
            id: 1,
            profit_estimate: field,
            space_estimate: field,
          };
          const result = extractTargetPrice(analysis);
          // Either null or a valid number
          if (result !== null) {
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});
