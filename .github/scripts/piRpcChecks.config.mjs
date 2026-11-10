import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tools = path.join(root, 'tmp/fork-ci-tools/node_modules');

// Real transport/bridge sources, with only the runner and debug dependency
// installed. No provider SDK, whole-app lifecycle, repository secret or model.
export default {
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: path.join(tools, 'vitest/dist/index.js') },
      { find: /^debug$/, replacement: path.join(tools, 'debug/src/index.js') },
      {
        find: '@lobechat/utils/managedProcess',
        replacement: path.join(root, 'packages/utils/src/managedProcess.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    maxWorkers: 1,
    fileParallelism: false,
    include: [
      'packages/heterogeneous-agents/src/rpc/piRpcClient.test.ts',
      'packages/heterogeneous-agents/src/rpc/piRpcUiRequests.test.ts',
      'packages/heterogeneous-agents/src/rpc/piRpcQuestionBridge.test.ts',
      'packages/heterogeneous-agents/src/rpc/rpcStdioClient.test.ts',
      'packages/heterogeneous-agents/src/askUser/AskUserBridge.test.ts',
      'packages/agent-gateway-client/src/intervention.test.ts',
    ],
  },
};
