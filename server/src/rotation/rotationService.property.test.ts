import * as fc from 'fast-check';
import { determinePhase, Phase } from './rotationService';

// Feature: ai-investment-assistant-phase2, Property 5
// Tasks 6.2, 6.3
test('highest score sector determines phase', () => {
  fc.assert(
    fc.property(
      fc.record({
        tech: fc.float({ min: -100, max: 100, noNaN: true }),
        cycle: fc.float({ min: -100, max: 100, noNaN: true }),
        consumer: fc.float({ min: -100, max: 100, noNaN: true }),
      }),
      (scores) => {
        const result = determinePhase(scores);
        const max = Math.max(scores.tech, scores.cycle, scores.consumer);
        if (result.phase === 'P1') return scores.tech === max;
        if (result.phase === 'P2') return scores.cycle === max;
        if (result.phase === 'P3') return scores.consumer === max;
        return false;
      }
    ),
    { numRuns: 200 }
  );
});

test('tie-breaking priority: tech > cycle > consumer', () => {
  fc.assert(
    fc.property(
      fc.float({ min: -50, max: 50, noNaN: true }),
      (score) => {
        const allEqual = determinePhase({ tech: score, cycle: score, consumer: score });
        if (allEqual.phase !== 'P1') return false;
        const techCycleTied = determinePhase({ tech: score, cycle: score, consumer: score - 1 });
        if (techCycleTied.phase !== 'P1') return false;
        const cycleConsumerTied = determinePhase({ tech: score - 1, cycle: score, consumer: score });
        if (cycleConsumerTied.phase !== 'P2') return false;
        return true;
      }
    ),
    { numRuns: 50 }
  );
});

test('phase label mapping is correct', () => {
  const labelMap: Record<Phase, string> = { P1: '科技成长', P2: '周期品', P3: '消费白酒' };
  fc.assert(
    fc.property(
      fc.record({
        tech: fc.float({ min: -100, max: 100, noNaN: true }),
        cycle: fc.float({ min: -100, max: 100, noNaN: true }),
        consumer: fc.float({ min: -100, max: 100, noNaN: true }),
      }),
      (scores) => {
        const result = determinePhase(scores);
        return result.label === labelMap[result.phase];
      }
    ),
    { numRuns: 100 }
  );
});

