import * as fc from 'fast-check';
import { startScheduler, stopScheduler, registerSSEClient, unregisterSSEClient } from './schedulerService';

describe('属性测试：定时任务调度启停', () => {
  afterEach(() => {
    stopScheduler();
  });

  it('startScheduler/stopScheduler 多次调用不应抛出异常', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        (actions) => {
          for (const shouldStart of actions) {
            if (shouldStart) {
              expect(() => startScheduler()).not.toThrow();
            } else {
              expect(() => stopScheduler()).not.toThrow();
            }
          }
          stopScheduler();
        }
      ),
      { numRuns: 20 }
    );
  });
});

describe('属性测试：SSE 客户端注册/注销', () => {
  it('注册和注销不应抛出异常', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (userId) => {
          const writes: string[] = [];
          const mockRes = { write: (data: string) => { writes.push(data); } };

          expect(() => registerSSEClient(userId, mockRes)).not.toThrow();
          expect(() => unregisterSSEClient(mockRes)).not.toThrow();
          // Double unregister should also be safe
          expect(() => unregisterSSEClient(mockRes)).not.toThrow();
        }
      ),
      { numRuns: 30 }
    );
  });
});
