import { describe, expect, it } from 'vitest';

import { PiAdapter } from './pi';

const metadata = (usage: unknown) => {
  const adapter = new PiAdapter();
  adapter.adapt({ type: 'turn_start' });
  return adapter
    .adapt({
      type: 'message_end',
      message: {
        content: [],
        model: 'synthetic-model',
        role: 'assistant',
        stopReason: 'stop',
        usage,
      },
    })
    .find((event) => event.type === 'step_complete')?.data;
};

const full = { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20 };

describe('Pi native four-bucket usage', () => {
  it('keeps fresh input, cache reads, cache writes and output disjoint', () => {
    expect(metadata(full)).toMatchObject({
      usage: {
        inputCacheMissTokens: 10,
        inputCachedTokens: 3,
        inputWriteCacheTokens: 2,
        totalInputTokens: 15,
        totalOutputTokens: 5,
        totalTokens: 20,
      },
    });
  });

  it('preserves a measured zero but does not turn a zero estimate into a free bill', () => {
    expect(
      metadata({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { total: 0 },
      }),
    ).toMatchObject({ usage: { totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0 } });
    expect(metadata({ ...full, cost: { total: 0 } })).not.toHaveProperty('costUsd');
  });

  it.each([
    {},
    { input: 10, output: 5 },
    { ...full, cacheRead: undefined },
    { ...full, cacheWrite: null },
    { ...full, input: -1 },
    { ...full, output: 1.5 },
    { ...full, cacheRead: Number.NaN },
    { ...full, cacheWrite: Number.POSITIVE_INFINITY },
    { ...full, input: '10' },
    { ...full, totalTokens: 999 },
    { ...full, totalTokens: -1 },
    { ...full, input: Number.MAX_SAFE_INTEGER, totalTokens: undefined },
  ])(
    'does not manufacture known zero buckets from incomplete or invalid native usage %#',
    (usage) => {
      expect(metadata(usage)).not.toHaveProperty('usage');
    },
  );

  it('uses the four measured buckets when the SDK leaves the optional provider total at zero', () => {
    expect(metadata({ ...full, totalTokens: 0 })).toMatchObject({ usage: { totalTokens: 20 } });
  });

  it('may derive the total from all four valid buckets when the native summary is absent', () => {
    expect(metadata({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2 })).toMatchObject({
      usage: { totalTokens: 20 },
    });
  });

  it('leaves invalid reasoning detail unknown without losing the four measured main buckets', () => {
    const result = metadata({ ...full, reasoning: -2 });
    expect(result).toMatchObject({ usage: { totalOutputTokens: 5 } });
    expect(result).not.toHaveProperty('usage.outputReasoningTokens');
    expect(result).not.toHaveProperty('usage.outputTextTokens');
  });
});
