import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AskUserBridge } from '../packages/heterogeneous-agents/src/askUser/AskUserBridge';
import { createPiRpcAgentHandle } from '../packages/heterogeneous-agents/src/rpc/piRpcAgentHandle';

const [sdk, questionEntry, root] = process.argv.slice(2);
for (const value of [sdk, questionEntry, root])
  assert.ok(value && path.isAbsolute(value) && path.normalize(value) === value);
assert.ok(
  path.resolve(root).startsWith(path.join(process.cwd(), 'tmp') + path.sep),
  'fixture must stay under this repository tmp/',
);
await mkdir(root, { recursive: true });
const wrapper = path.join(root, 'pi');
await writeFile(wrapper, `#!/bin/sh\nexec node ${JSON.stringify(sdk + '/dist/cli.js')} "$@"\n`);
await chmod(wrapper, 0o700);
const fixture = path.join(root, 'fixture.ts');
await writeFile(
  fixture,
  `import register from ${JSON.stringify(questionEntry)};
export default function(pi) {
  let tool;
  let providerRequests = 0;
  register(new Proxy(pi, { get(target, key) {
    if (key === 'registerTool') return value => { tool = value; pi.registerTool(value); };
    return Reflect.get(target, key);
  }}));
  pi.on('before_provider_request', () => { providerRequests++; throw Error('provider forbidden'); });
  pi.registerCommand('fixture-question', { handler: async (kind, ctx) => {
    const result = await tool.execute('fixture-' + kind, { question: 'Choose', options: [{label:'A'}, {label:'A'}, {label:'B'}], multiSelect:kind === 'multi' }, new AbortController().signal, undefined, ctx);
    ctx.ui.notify('fixture-result:' + JSON.stringify({ kind, result, providerRequests }), 'info');
  }});
}
`,
);
const outcomes = [];
for (const [kind, indices] of [
  ['single', [1]],
  ['custom', [3]],
  ['chat', [4]],
  ['multi', [2, 0, 1, 3]],
  ['cancel', []],
] as const) {
  const selections = [...indices];
  const bridge = new AskUserBridge('native-' + kind, { provider: 'pi', identifier: 'claude-code' });
  const requests: unknown[] = [];
  const pumping = (async () => {
    for await (const event of bridge.events()) {
      if (event.type !== 'agent_intervention_request') continue;
      requests.push(event);
      const args = JSON.parse(event.data.arguments);
      assert.equal(args.autoSubmitOnTimeout, false);
      const question = args.questions[0];
      const index = selections.shift();
      if (kind === 'custom' && question.options.length === 0) {
        bridge.resolve(event.data.toolCallId, { result: { [question.question]: 'bridged 中文' } });
      } else if (index === undefined) bridge.cancel(event.data.toolCallId);
      else
        bridge.resolve(event.data.toolCallId, {
          result: { [question.question]: question.options[index].id },
        });
    }
  })();
  let raw = '';
  const handle = await createPiRpcAgentHandle({
    args: [
      '--no-session',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '-e',
      fixture,
      '--tools',
      'ask_user_question',
    ],
    askUserBridge: bridge,
    commandPath: wrapper,
    cwd: root,
    env: {
      HOME: root,
      PI_CODING_AGENT_DIR: path.join(root, 'agent'),
      PATH: process.env.PATH,
      TMPDIR: root,
      NO_COLOR: '1',
    },
    operationId: 'native-' + kind,
    onRawStdout: (data) => {
      raw += data.toString();
    },
    prompt: { text: '/fixture-question ' + kind },
  });
  let stderr = '';
  handle.stderr.on('data', (data) => {
    stderr += data;
  });
  await Promise.all([
    (async () => {
      for await (const _ of handle.events) {
      }
    })(),
    handle.exit,
  ]);
  await pumping;
  assert.equal((await handle.exit).code, 0, stderr);
  const notification = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    })
    .find((event) => event.method === 'notify' && event.message?.startsWith('fixture-result:'));
  assert.ok(notification, raw);
  const outcome = JSON.parse(notification.message.slice('fixture-result:'.length));
  assert.equal(outcome.providerRequests, 0);
  assert.ok(!outcome.result.isError);
  assert.ok(handle.sessionId);
  outcomes.push({
    kind,
    nativeSessionId: handle.sessionId,
    questions: requests.length,
    details: outcome.result.details,
  });
}
assert.equal(outcomes[0].details.answer, 'A');
assert.equal(outcomes[1].details.answer, 'bridged 中文');
assert.equal(outcomes[2].details.wasChat, true);
assert.deepEqual(outcomes[3].details.selectedIndices, [0, 1, 2]);
assert.equal(outcomes[4].details.answer, null);
console.log(
  JSON.stringify({
    actualLobeRpcHandle: true,
    selectedSdk: sdk,
    cases: outcomes,
    providerRequests: 0,
  }),
);
