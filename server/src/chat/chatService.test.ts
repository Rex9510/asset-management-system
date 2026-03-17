import Database from 'better-sqlite3';
import { initializeDatabase } from '../db/init';

let testDb: Database.Database;

jest.mock('../db/connection', () => ({
  getDatabase: () => testDb,
}));

const mockChat = jest.fn();
jest.mock('../ai/aiProviderFactory', () => ({
  getAIProvider: () => ({
    analyze: jest.fn(),
    chat: mockChat,
    getModelName: () => 'mock-model',
  }),
}));

import { sendMessage, getChatHistory, detectSellIntent, evaluateCalmDown } from './chatService';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  initializeDatabase(db);
  return db;
}

function createUser(db: Database.Database, username = 'testuser'): number {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, 'hash123');
  return (db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number }).id;
}

describe('chatService', () => {
  let userId: number;

  beforeEach(() => {
    testDb = makeDb();
    userId = createUser(testDb);
    mockChat.mockReset();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('detectSellIntent', () => {
    it('should detect sell keywords', () => {
      expect(detectSellIntent('我想卖掉这只股票')).toBe(true);
      expect(detectSellIntent('准备清仓了')).toBe(true);
      expect(detectSellIntent('要不要出了')).toBe(true);
      expect(detectSellIntent('割肉吧')).toBe(true);
      expect(detectSellIntent('该止损了')).toBe(true);
      expect(detectSellIntent('赶紧跑')).toBe(true);
      expect(detectSellIntent('抛掉算了')).toBe(true);
    });

    it('should not detect when no sell keywords', () => {
      expect(detectSellIntent('这只股票怎么样')).toBe(false);
      expect(detectSellIntent('帮我分析一下600000')).toBe(false);
      expect(detectSellIntent('今天大盘走势如何')).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should save user message and AI response', async () => {
      mockChat.mockResolvedValue('这是一个参考方案：当前走势偏强。');

      const response = await sendMessage(userId, '帮我分析一下600000', '600000', testDb);

      expect(response.role).toBe('assistant');
      expect(response.content).toBe('这是一个参考方案：当前走势偏强。');
      expect(response.userId).toBe(userId);
    });

    it('should save both user and assistant messages to database', async () => {
      mockChat.mockResolvedValue('AI回复内容');

      await sendMessage(userId, '你好', undefined, testDb);

      const rows = testDb.prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id').all(userId) as any[];
      expect(rows).toHaveLength(2);
      expect(rows[0].role).toBe('user');
      expect(rows[0].content).toBe('你好');
      expect(rows[1].role).toBe('assistant');
      expect(rows[1].content).toBe('AI回复内容');
    });

    it('should throw on empty content', async () => {
      await expect(sendMessage(userId, '', undefined, testDb)).rejects.toThrow('消息内容不能为空');
      await expect(sendMessage(userId, '   ', undefined, testDb)).rejects.toThrow('消息内容不能为空');
    });

    it('should throw when AI service fails', async () => {
      mockChat.mockRejectedValue(new Error('API error'));

      await expect(sendMessage(userId, '你好', undefined, testDb)).rejects.toThrow('AI服务暂时不可用');
    });

    it('should pass stock_code when provided', async () => {
      mockChat.mockResolvedValue('分析结果');

      const response = await sendMessage(userId, '分析这只股票', '600000', testDb);

      expect(response.stockCode).toBe('600000');
    });
  });

  describe('getChatHistory', () => {
    it('should return empty array when no messages', () => {
      const history = getChatHistory(userId, 50, testDb);
      expect(history).toEqual([]);
    });

    it('should return messages in chronological order', async () => {
      mockChat.mockResolvedValue('回复1');
      await sendMessage(userId, '消息1', undefined, testDb);

      mockChat.mockResolvedValue('回复2');
      await sendMessage(userId, '消息2', undefined, testDb);

      const history = getChatHistory(userId, 50, testDb);
      expect(history).toHaveLength(4); // 2 user + 2 assistant
      expect(history[0].content).toBe('消息1');
      expect(history[1].content).toBe('回复1');
      expect(history[2].content).toBe('消息2');
      expect(history[3].content).toBe('回复2');
    });

    it('should respect limit parameter', async () => {
      mockChat.mockResolvedValue('回复');
      await sendMessage(userId, '消息1', undefined, testDb);
      await sendMessage(userId, '消息2', undefined, testDb);
      await sendMessage(userId, '消息3', undefined, testDb);

      const history = getChatHistory(userId, 2, testDb);
      expect(history).toHaveLength(2);
    });

    it('should not return other user messages', async () => {
      mockChat.mockResolvedValue('回复');
      await sendMessage(userId, '消息1', undefined, testDb);

      const otherUserId = createUser(testDb, 'otheruser');
      const otherHistory = getChatHistory(otherUserId, 50, testDb);
      expect(otherHistory).toEqual([]);
    });
  });

  describe('evaluateCalmDown', () => {
    it('should return CalmDownEvaluation when AI returns valid JSON', async () => {
      mockChat.mockResolvedValue(JSON.stringify({
        buyLogicReview: '当初买入是因为技术面看好',
        sellJudgment: 'emotional',
        worstCaseEstimate: '最坏情况可能再跌10%',
        recommendation: '参考方案：冷静观察后再决定',
      }));

      const result = await evaluateCalmDown(userId, '600000', testDb);

      expect(result.buyLogicReview).toBe('当初买入是因为技术面看好');
      expect(result.sellJudgment).toBe('emotional');
      expect(result.worstCaseEstimate).toBe('最坏情况可能再跌10%');
      expect(result.recommendation).toBe('参考方案：冷静观察后再决定');
    });

    it('should return rational judgment when AI says rational', async () => {
      mockChat.mockResolvedValue(JSON.stringify({
        buyLogicReview: '买入逻辑已不成立',
        sellJudgment: 'rational',
        worstCaseEstimate: '继续持有风险较大',
        recommendation: '参考方案：可考虑分批减仓',
      }));

      const result = await evaluateCalmDown(userId, '600000', testDb);
      expect(result.sellJudgment).toBe('rational');
    });

    it('should fallback when AI returns invalid JSON', async () => {
      mockChat.mockResolvedValue('这不是一个有效的JSON响应');

      const result = await evaluateCalmDown(userId, '600000', testDb);

      expect(result.buyLogicReview).toBeDefined();
      expect(result.sellJudgment).toBe('emotional');
      expect(result.worstCaseEstimate).toBeDefined();
      expect(result.recommendation).toBeDefined();
    });

    it('should throw on empty stockCode', async () => {
      await expect(evaluateCalmDown(userId, '', testDb)).rejects.toThrow('请提供股票代码');
    });

    it('should throw when AI service fails', async () => {
      mockChat.mockRejectedValue(new Error('API error'));

      await expect(evaluateCalmDown(userId, '600000', testDb)).rejects.toThrow('AI服务暂时不可用');
    });

    it('should include position context when user has position', async () => {
      // Add a position for the user
      testDb.prepare(
        'INSERT INTO positions (user_id, stock_code, stock_name, cost_price, shares, buy_date) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(userId, '600000', '浦发银行', 10.5, 1000, '2024-01-15');

      mockChat.mockResolvedValue(JSON.stringify({
        buyLogicReview: '买入逻辑回顾',
        sellJudgment: 'emotional',
        worstCaseEstimate: '最坏预估',
        recommendation: '参考方案',
      }));

      await evaluateCalmDown(userId, '600000', testDb);

      // Verify AI was called with position context
      expect(mockChat).toHaveBeenCalled();
      const callArgs = mockChat.mock.calls[0];
      const messages = callArgs[0];
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.content).toContain('浦发银行');
      expect(lastMessage.content).toContain('10.5');
    });
  });
});
