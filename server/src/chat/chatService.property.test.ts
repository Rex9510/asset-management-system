import * as fc from 'fast-check';
import { detectSellIntent } from './chatService';

describe('属性测试：冷静机制卖出意图检测', () => {
  it('包含卖出关键词的消息应被检测到', () => {
    const sellKeywords = ['卖', '清仓', '出', '割肉', '止损', '跑', '抛'];
    fc.assert(
      fc.property(
        fc.constantFrom(...sellKeywords),
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (keyword, prefix, suffix) => {
          const message = prefix + keyword + suffix;
          expect(detectSellIntent(message)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('不包含任何卖出关键词的纯英文/数字消息不应触发', () => {
    const safeChars = 'abcdefghijklmnopqrstuvwxyz0123456789 ,.';
    const safeString = fc.stringOf(fc.constantFrom(...safeChars.split('')), { minLength: 1, maxLength: 50 });
    fc.assert(
      fc.property(safeString, (message) => {
        expect(detectSellIntent(message)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
