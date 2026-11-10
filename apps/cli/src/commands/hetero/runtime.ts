import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { createPiRpcAgentHandle, type PiRpcStartupControl, preparePiRpcInput } from '@lobechat/heterogeneous-agents/rpc';
import { createCodexAgentHandle, spawnAgent } from '@lobechat/heterogeneous-agents/spawn';

import { cliVersion } from '../../pkg';

/**
 * Runtime factories for `lh hetero exec`. Pi uses RPC; other agents fall
 * through to the generic one-shot `spawnAgent`.
 */
const spawnRuntimeRegistry: Partial<
  Record<
    LocalHeterogeneousAgentType,
    (
      spawnOpts: Parameters<typeof spawnAgent>[0],
      lifecycle?: {
        onRawStdout?: (chunk: Buffer) => void;
        onStartupControl?: (control: PiRpcStartupControl) => void;
      },
    ) => Promise<Awaited<ReturnType<typeof spawnAgent>>>
  >
> = {
  pi: async (spawnOpts, lifecycle) =>
    createPiRpcAgentHandle({
      ...(await preparePiRpcInput(spawnOpts.prompt, {
        args: spawnOpts.extraArgs ?? [],
        lobeHubContext: !!spawnOpts.env?.LOBEHUB_TOPIC_ID,
      })),
      commandPath: spawnOpts.command!,
      cwd: spawnOpts.cwd ?? process.cwd(),
      detached: spawnOpts.detached,
      env: { ...process.env, ...spawnOpts.env },
      operationId: spawnOpts.operationId,
      onRawStdout: lifecycle?.onRawStdout,
      onStartupControl: lifecycle?.onStartupControl,
      resumeSessionId: spawnOpts.resumeSessionId,
      uploadImage: spawnOpts.uploadImage,
    }),
};

/**
 * Spawn via the registered runtime factory, or the generic one-shot spawn.
 * `onRawStdout` (raw-dump tee) reaches both generic and registered runtimes;
 * RPC runtimes must install it before their eager handshake.
 */
export const spawnAgentOrRuntime = (
  spawnOpts: Parameters<typeof spawnAgent>[0],
  onRawStdout?: (chunk: Buffer) => void,
  onStartupControl?: (control: PiRpcStartupControl) => void,
  nativeCodex?: boolean,
): Promise<Awaited<ReturnType<typeof spawnAgent>>> => {
  if (nativeCodex)
    return createCodexAgentHandle({
      askUserBridge: spawnOpts.askUserBridge,
      clientVersion: cliVersion,
      args: spawnOpts.extraArgs ?? [],
      commandPath: spawnOpts.command!,
      cwd: spawnOpts.cwd ?? process.cwd(),
      env: { ...process.env, ...spawnOpts.env },
      onRawStdout,
      onStartupControl,
      operationId: spawnOpts.operationId,
      prompt: spawnOpts.prompt,
      resumeSessionId: spawnOpts.resumeSessionId,
    });
  const runtimeFactory = spawnRuntimeRegistry[spawnOpts.agentType as LocalHeterogeneousAgentType];
  if (runtimeFactory) return runtimeFactory(spawnOpts, { onRawStdout, onStartupControl });
  return spawnAgent({ ...spawnOpts, onRawStdout });
};
