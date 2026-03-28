/**
 * SSE 频率测试
 * Task 1.6 (server-side)
 */
import fs from 'fs';
import path from 'path';

// Feature: ai-investment-assistant-phase2, 一期行为调整
// 验证需求：SSE推送间隔为30分钟（1800000ms）
test('SSE_POLL_INTERVAL_MS 应为 1800000ms（30分钟）', () => {
  const filePath = path.resolve(__dirname, 'marketRoutes.ts');
  const content = fs.readFileSync(filePath, 'utf-8');

  // Verify the constant is set to 1800000
  const match = content.match(/SSE_POLL_INTERVAL_MS\s*=\s*(\d+)/);
  expect(match).not.toBeNull();
  expect(Number(match![1])).toBe(1800000);
});
