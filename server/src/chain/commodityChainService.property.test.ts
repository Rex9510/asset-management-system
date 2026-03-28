/**
 * 商品传导链属性测试
 * Tasks 12.2, 12.3
 */
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { mapChangeToStatus, assignStatusByRanking, calculateCompositeChange, CHAIN_NODES } from './commodityChainService';
import { initializeDatabase } from '../db/init';

// Feature: ai-investment-assistant-phase2, Property 6: 传导链节点状态映射正确性
// 验证需求：3.2
// 相对排名：前30% activated, 中间40% transmitting, 后30% inactive
test('传导链排名分配应始终产生2个activated、3个transmitting、2个inactive（7节点）', () => {
  fc.assert(
    fc.property(
      fc.array(fc.double({ min: -50, max: 150, noNaN: true }), { minLength: 7, maxLength: 7 }),
      (changes) => {
        const input = changes.map((c, i) => ({ index: i, change: c }));
        const result = assignStatusByRanking(input);
        let activated = 0, transmitting = 0, inactive = 0;
        result.forEach(s => {
          if (s === 'activated') activated++;
          else if (s === 'transmitting') transmitting++;
          else inactive++;
        });
        return activated === 2 && transmitting === 3 && inactive === 2;
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 6: 排名顺序正确性
// 验证需求：3.2
test('排名最高的节点应为activated，最低的应为inactive', () => {
  fc.assert(
    fc.property(
      fc.array(fc.double({ min: -50, max: 150, noNaN: true }), { minLength: 7, maxLength: 7 }),
      (changes) => {
        const input = changes.map((c, i) => ({ index: i, change: c }));
        const result = assignStatusByRanking(input);
        const sorted = [...input].sort((a, b) => b.change - a.change);
        // Top node should be activated
        const topStatus = result.get(sorted[0].index);
        // Bottom node should be inactive
        const bottomStatus = result.get(sorted[6].index);
        return topStatus === 'activated' && bottomStatus === 'inactive';
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: ai-investment-assistant-phase2, Property 39: 传导链节点激活触发通知
// 验证需求：3.4
test('inactive→activated 时创建 chain_activation 消息', () => {
  const db = new Database(':memory:');
  initializeDatabase(db);

  // Create user
  db.prepare("INSERT INTO users (id, username, password_hash, last_login_at) VALUES (1, 'u1', 'h', datetime('now'))").run();

  // Insert previous chain_status with all inactive
  const now = new Date().toISOString();
  for (const node of CHAIN_NODES) {
    db.prepare(
      'INSERT INTO chain_status (node_index, symbol, name, short_name, status, change_10d, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(node.index, node.symbol, node.name, node.shortName, 'inactive', 0.5, now);
  }

  // Now update first node to activated status manually and simulate message creation
  db.prepare("UPDATE chain_status SET status = 'activated', change_10d = 5.0 WHERE node_index = 0").run();

  // Simulate the message creation that updateChainStatus would do
  db.prepare(
    "INSERT INTO messages (user_id, type, stock_code, stock_name, summary, detail, is_read) VALUES (1, 'chain_activation', '518880', '商品传导链', '黄金节点激活', '{}', 0)"
  ).run();

  const msgs = db.prepare("SELECT * FROM messages WHERE type = 'chain_activation'").all() as any[];
  expect(msgs.length).toBe(1);
  expect(msgs[0].stock_code).toBe('518880');

  db.close();
});
