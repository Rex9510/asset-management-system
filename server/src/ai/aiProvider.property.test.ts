import * as fc from 'fast-check';
import { AIProvider, AnalysisContext, AnalysisResult, ChatMessage } from './aiProvider';
import { DeepSeekProvider } from './deepSeekProvider';
import { ClaudeProvider } from './claudeProvider';
import { QwenProvider } from './qwenProvider';

describe('属性测试：AI提供者接口一致性', () => {
  it('所有 AI Provider 实现应具有 analyze/chat/getModelName 方法', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('deepseek', 'claude', 'qwen'),
        (providerName) => {
          let provider: AIProvider;
          switch (providerName) {
            case 'deepseek':
              provider = new DeepSeekProvider('test-key');
              break;
            case 'claude':
              provider = new ClaudeProvider('test-key');
              break;
            case 'qwen':
              provider = new QwenProvider('test-key');
              break;
            default:
              throw new Error('unknown');
          }

          expect(typeof provider.analyze).toBe('function');
          expect(typeof provider.chat).toBe('function');
          expect(typeof provider.getModelName).toBe('function');
          expect(typeof provider.getModelName()).toBe('string');
          expect(provider.getModelName().length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 10 }
    );
  });
});
