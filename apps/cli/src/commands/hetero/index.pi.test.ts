import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { buildHeterogeneousPrompt } from '@lobechat/heterogeneous-agents/protocol';
import type * as HeteroRpc from '@lobechat/heterogeneous-agents/rpc';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './index';

const { createHandle, finish, ingest, resolveCommand } = vi.hoisted(() => ({
  resolveCommand: vi.fn().mockResolvedValue({ command: 'pi' }),
  createHandle: vi.fn(),
  finish: vi.fn().mockResolvedValue({ ack: true }),
  ingest: vi.fn().mockResolvedValue({ ack: true }),
}));

vi.mock('@lobechat/heterogeneous-agents/rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof HeteroRpc>()),
  createPiRpcAgentHandle: createHandle,
}));
vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: resolveCommand,
}));
vi.mock('../../api/client', () => ({
  getTrpcClient: async () => ({
    aiAgent: { heteroFinish: { mutate: finish }, heteroIngest: { mutate: ingest } },
  }),
}));
vi.mock('../../utils/OperationTokenRenewal', () => ({
  createOperationTokenRenewal: () => ({ active: true, stop: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resolveCommand.mockResolvedValue({ command: 'pi' });
});

const runCmd = async (argv: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerHeteroCommand(program);
  await expect(program.parseAsync(argv, { from: 'user' })).rejects.toThrow('test process exit');
};

describe('Pi dispatched prompt delivery', () => {
  it('runs Pi over RPC preserving model, thinking, native config, and resume while ignoring non-Pi speed', async () => {
    vi.stubEnv('HOME', '/pi-test-home');
    vi.stubEnv('PI_CODING_AGENT_DIR', '/pi-test-config');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only-key');
    resolveCommand.mockResolvedValue({ command: 'pi', pathEnv: '/pi-custom-bin' });
    const stderr = new PassThrough();
    stderr.end();
    createHandle.mockResolvedValue({
      events: (async function* () {})(),
      exit: Promise.resolve({ code: 0, signal: null }),
      kill: vi.fn(),
      stderr,
    });
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('test process exit');
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runCmd([
      'hetero',
      'exec',
      '--type',
      'pi',
      '--prompt',
      'do thing',
      '--resume',
      'pi-session-1',
      '--model',
      'anthropic/claude-sonnet-4-5',
      '--effort',
      'high',
      '--speed',
      'fast',
      '--agent-arg=--provider',
      '--agent-arg=anthropic',
    ]);

    expect(resolveCommand).toHaveBeenCalledWith('pi', undefined);
    expect(createHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          '--provider',
          'anthropic',
          '--model',
          'anthropic/claude-sonnet-4-5',
          '--thinking',
          'high',
        ],
        commandPath: 'pi',
        env: expect.objectContaining({
          HOME: '/pi-test-home',
          PI_CODING_AGENT_DIR: '/pi-test-config',
          ANTHROPIC_API_KEY: 'test-only-key',
          PATH: '/pi-custom-bin',
        }),
        operationId: expect.any(String),
        onRawStdout: undefined,
        onStartupControl: expect.any(Function),
        resumeSessionId: 'pi-session-1',
      }),
    );
  });

  it.each([false, true])(
    'loads a native skill without including the guide in user text (resume: %s)',
    async (resumed) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'lh-pi-dispatch-'));
      const inputPath = path.join(dir, 'input.json');
      const stderr = new PassThrough();
      stderr.end();
      createHandle.mockResolvedValue({
        events: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        kill: vi.fn(),
        pid: undefined,
        stderr,
      });
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('test process exit');
      });
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        await writeFile(
          inputPath,
          JSON.stringify(
            buildHeterogeneousPrompt({
              isNewSession: !resumed,
              prompt: 'Read the local file',
              systemContext: 'Selected source text',
            }),
          ),
        );
        const program = new Command();
        program.exitOverride();
        registerHeteroCommand(program);
        await expect(
          program.parseAsync(
            [
              'hetero',
              'exec',
              '--type',
              'pi',
              '--input-json',
              inputPath,
              '--topic',
              'tpc_pi_dispatch',
              '--operation-id',
              'op-pi-dispatch',
              ...(resumed ? ['--resume', 'pi-native-session'] : []),
            ],
            { from: 'user' },
          ),
        ).rejects.toThrow('test process exit');

        expect(exit).toHaveBeenCalledWith(0);
        expect(createHandle).toHaveBeenCalledOnce();
        const launch = createHandle.mock.calls[0][0];
        expect(launch.askUserBridge).toMatchObject({
          operationId: 'op-pi-dispatch',
          pending: expect.any(Function),
        });
        expect(launch.args).toEqual(['--skill', expect.any(String)]);
        expect(await readFile(launch.args[1], 'utf8')).toContain('# LobeHub CLI (`lh`)');
        expect(launch.prompt).toEqual({ text: 'Selected source text\n\nRead the local file' });
        expect(launch.resumeSessionId).toBe(resumed ? 'pi-native-session' : undefined);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
