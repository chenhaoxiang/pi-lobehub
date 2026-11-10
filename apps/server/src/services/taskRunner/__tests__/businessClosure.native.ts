import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createPiRpcAgentHandle } from '../../../../../../packages/heterogeneous-agents/src/rpc/piRpcAgentHandle';

/** Opt-in local native proof. CI stays provider-free without a Pi installation. */
export const runNativeClosureFixture = async (input: {
  operationId: string;
  prompt: string;
  taskId: string;
}) => {
  const sdk = process.env.PI_TASK_GOAL_NATIVE_SDK;
  if (!sdk) return;
  const root = path.resolve(process.env.PI_TASK_GOAL_NATIVE_DIR ?? 'tmp/pi-task-goal-native');
  if (!path.isAbsolute(sdk) || !root.startsWith(path.join(process.cwd(), 'tmp') + path.sep)) {
    throw new Error('Native fixture requires an explicit SDK and repository-local tmp directory');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const wrapper = path.join(root, 'pi');
  const extension = path.join(root, 'delivery.mjs');
  const artifact = path.join(root, `${input.operationId}.json`);
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec node ${JSON.stringify(path.join(sdk, 'dist/cli.js'))} "$@"\n`,
    { mode: 0o700 },
  );
  await chmod(wrapper, 0o700);
  await writeFile(
    extension,
    `import { writeFileSync } from 'node:fs';
export default function(pi) {
  let providerRequests = 0;
  pi.on('before_provider_request', () => { providerRequests++; throw new Error('Native closure fixture forbids model requests'); });
  pi.registerCommand('fixture-deliver', { handler: async (args, ctx) => {
    const input = JSON.parse(args);
    const result = { taskId: input.taskId, operationId: input.operationId, providerRequests,
      kind: 'deterministic-native-fixture-not-business-model',
      content: '# Local task deliverable\\n\\n' + input.prompt };
    writeFileSync(input.artifact, JSON.stringify(result, null, 2), { mode: 0o600 });
    ctx.ui.notify('native-delivery-written:' + input.operationId, 'info');
  }});
}
`,
    { mode: 0o600 },
  );
  const handle = await createPiRpcAgentHandle({
    args: [
      '--no-session',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '-e',
      extension,
    ],
    commandPath: wrapper,
    cwd: root,
    env: {
      HOME: root,
      PI_CODING_AGENT_DIR: path.join(root, 'agent'),
      PATH: process.env.PATH,
      TMPDIR: root,
      NO_COLOR: '1',
    },
    operationId: input.operationId,
    prompt: { text: '/fixture-deliver ' + JSON.stringify({ ...input, artifact }) },
  });
  let stderr = '';
  handle.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  try {
    for await (const _ of handle.events) {
      /* The normal bridge drains the native stream. */
    }
    const result = await handle.exit;
    if (result.code !== 0 || !handle.sessionId) throw new Error(`Native fixture failed: ${stderr}`);
    const delivery = JSON.parse(await readFile(artifact, 'utf8'));
    if (
      delivery.operationId !== input.operationId ||
      delivery.taskId !== input.taskId ||
      delivery.providerRequests !== 0
    ) {
      throw new Error('Native fixture delivery identity or provider count did not match');
    }
    await writeFile(
      path.join(root, `${input.operationId}.receipt.json`),
      JSON.stringify(
        {
          artifact,
          nativeSessionId: handle.sessionId,
          operationId: input.operationId,
          providerRequests: 0,
          sdk,
          taskId: input.taskId,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    handle.kill('SIGTERM');
    await handle.exit;
  }
};
