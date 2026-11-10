import { describe, expect, it } from 'vitest';

import { buildExtraArgs } from './selectorArgs';

describe('Pi native selector arguments', () => {
  it('forwards the selected thinking level, provider/model and native config paths', () => {
    expect(
      buildExtraArgs({
        agentArg: [
          '--provider',
          'test-provider',
          '--extension',
          '/fixture/ask.ts',
          '--skill',
          '/fixture/SKILL.md',
        ],
        effort: 'high',
        model: 'test-provider/test-model',
        speed: 'fast',
        type: 'pi',
      }),
    ).toEqual([
      '--provider',
      'test-provider',
      '--extension',
      '/fixture/ask.ts',
      '--skill',
      '/fixture/SKILL.md',
      '--model',
      'test-provider/test-model',
      '--thinking',
      'high',
    ]);
  });

  it('does not override the original CLI defaults when no selectors were requested', () => {
    expect(buildExtraArgs({ type: 'pi' })).toBeUndefined();
    expect(buildExtraArgs({ type: 'pi', agentArg: ['--no-extensions'] })).toEqual([
      '--no-extensions',
    ]);
  });
});
