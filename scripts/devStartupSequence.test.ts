/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __testing } from './devStartupSequence.mts';

afterEach(() => vi.unstubAllEnvs());

describe('explicit isolated dev host', () => {
  it('preserves the existing default when no host override was requested', () => {
    vi.stubEnv('DEV_HOST', '');
    expect(__testing.createNextDevArgs(3010)).toEqual(['next', 'dev', '-p', '3010']);
  });
  it('passes the explicit loopback host to the real Next launcher', () => {
    vi.stubEnv('DEV_HOST', '127.0.0.1');
    expect(__testing.createNextDevArgs(27173)).toEqual([
      'next',
      'dev',
      '-p',
      '27173',
      '--hostname',
      '127.0.0.1',
    ]);
  });
});
