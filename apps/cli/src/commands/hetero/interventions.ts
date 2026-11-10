import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { AskUserBridge } from '@lobechat/heterogeneous-agents/askUser';
import { LobeBuiltinMcpServer } from '@lobechat/heterogeneous-agents/builtinMcp';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

import { getTrpcClient } from '../../api/client';
import type { CoalescingBatchIngester } from '../../utils/CoalescingBatchIngester';

/** Operation-scoped human-input transport, shared by native RPC/ACP and MCP. */
export const createHeteroInterventions = async (options: {
  agentType: LocalHeterogeneousAgentType;
  codexAppServer?: boolean;
  operationId: string;
  serverIngest: boolean;
  serverIngester?: Pick<CoalescingBatchIngester, 'push'>;
}) => {
  const { agentType, operationId, serverIngest, serverIngester } = options;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let askServer: LobeBuiltinMcpServer | undefined;
  let askBridge: AskUserBridge | undefined;
  let askMcpConfigPath: string | undefined;
  const askPollAbort = new AbortController();
  if (
    serverIngest &&
    (agentType === 'claude-code' ||
      (agentType === 'codex' && options.codexAppServer) ||
      agentType === 'copilot' ||
      agentType === 'cursor' ||
      agentType === 'droid' ||
      agentType === 'pi' ||
      agentType === 'devin' ||
      agentType === 'qoder') &&
    serverIngester
  ) {
    if (
      agentType === 'codex' ||
      agentType === 'copilot' ||
      agentType === 'cursor' ||
      agentType === 'devin' ||
      agentType === 'droid' ||
      agentType === 'pi'
    ) {
      askBridge = new AskUserBridge(operationId, {
        identifier: agentType === 'cursor' || agentType === 'pi' ? 'claude-code' : agentType,
        provider: agentType,
      });
    } else {
      askServer = new LobeBuiltinMcpServer();
      await askServer.start();
      askBridge = askServer.registerOperation(
        operationId,
        new AskUserBridge(operationId, { identifier: agentType, provider: agentType }),
      );
      askMcpConfigPath = path.join(os.tmpdir(), `lobe-cc-mcp-${operationId}.json`);
      await writeFile(
        askMcpConfigPath,
        JSON.stringify({
          mcpServers: {
            lobe_cc: {
              alwaysLoad: true,
              type: 'http',
              url: askServer.urlForOperation(operationId),
            },
          },
        }),
        'utf8',
      );
    }

    // (i) Forward every bridge event into the same ordered durable ingest path
    // as CC's. Browser submit already XADDed a response for producer delivery,
    // but that is only transport acceptance. The bridge echo after resolve is
    // the producer ACK (producerAck=true + resolutionRequestId) that transitions
    // Cloud from `resolving` to terminal. Persistence de-dupes transitions by
    // (operationId, toolCallId, transition).
    void (async () => {
      for await (const event of askBridge!.events()) {
        serverIngester!.push(event as AgentStreamEvent);
      }
    })();

    // (ii) Long-poll the server for the user's answer — only while a question is
    // actually pending, so an idle run holds no server invocation.
    void (async () => {
      const client = await getTrpcClient();
      // Start at the beginning of this operation stream. A response can be
      // published after `pendingCount` flips but before the first XREAD; `$`
      // would skip that already-present response and strand the CLI until the
      // bridge timeout. Unknown/stale tool ids are harmless (`resolve` no-ops).
      let lastEventId = '0-0';
      while (!askPollAbort.signal.aborted) {
        if (askBridge!.pendingCount === 0) {
          await sleep(200);
          continue;
        }
        try {
          const res = await client.aiAgent.waitInterventionResponse.query({
            lastEventId,
            operationId,
          });
          lastEventId = res.lastEventId;
          for (const event of res.events) {
            const data = event.data as {
              cancelReason?: 'session_ended' | 'timeout' | 'user_cancelled';
              cancelled?: boolean;
              result?: unknown;
              resolutionRequestId?: string;
              toolCallId: string;
            };
            // Idempotent: resolve() no-ops on an unknown / already-settled id.
            askBridge!.resolve(data.toolCallId, {
              cancelReason: data.cancelReason,
              cancelled: data.cancelled,
              result: data.result,
              resolutionRequestId: data.resolutionRequestId,
            });
          }
        } catch {
          // Transient (server hiccup / token refresh) — back off and retry.
          // The bridge's 10-min timeout still bounds the overall wait.
          await sleep(1000);
        }
      }
    })();
  }

  return {
    askBridge,
    askMcpConfigPath,
    stop: async () => {
      askPollAbort.abort();
      if (askServer) {
        askServer.unregisterOperation(operationId);
        await askServer.stop().catch(() => {});
      } else askBridge?.cancelAll('session_ended');
      if (askMcpConfigPath) await unlink(askMcpConfigPath).catch(() => {});
    },
  };
};
