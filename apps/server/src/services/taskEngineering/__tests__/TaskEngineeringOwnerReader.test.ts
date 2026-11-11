// @vitest-environment node
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { TaskEngineeringPullRequest } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskEngineeringOwnerReader } from '../TaskEngineeringOwnerReader';

let directory: string;
let contractFile: string;
let modulePath: string;
const taskId = 'task-explicit-owner';
const head = 'a'.repeat(40);
const contract = () => ({
  binding: {
    workRef: { owner: 'chenhaoxiang/pi-lobehub', kind: 'task', key: taskId },
    stageId: 'source-shared-delivery',
    runId: 'synthetic-source-read',
    sessionId: 'synthetic-owner-context',
    revision: 0,
    headSha: head,
  },
  repository: 'chenhaoxiang/pi-lobehub',
  pullRequest: 6,
  baseRef: 'main',
  headChecks: [{ name: 'fork-contract', appId: 15368 }],
  mergeWorkflows: ['Pi Fork Check'],
  repositoryReview: { commentId: 1, author: 'synthetic-owner', bodySha256: 'b'.repeat(64) },
});
const linked: TaskEngineeringPullRequest[] = [
  {
    binding: 'task',
    source: 'manual-link',
    repository: 'chenhaoxiang/pi-lobehub',
    number: 6,
    url: 'https://github.com/chenhaoxiang/pi-lobehub/pull/6',
    headSha: head,
    ciHeadSha: null,
    ciStatus: 'unknown',
    state: null,
    recordedAt: null,
    recordedCheckCount: 0,
    checks: [],
    checksTruncated: false,
  },
];
const source = `export async function readCodeStage(c) {
 return { progress: { binding: { ...c.binding, workRef: { key:c.binding.workRef.key,kind:c.binding.workRef.kind,owner:c.binding.workRef.owner } },repository:c.repository,pullRequest:c.pullRequest,observedAt:Date.now(),phase:'source-delivery',waitReason:'none',nextAction:'inspect_result',authorization:'none',readOnly:true,executable:false } };
}`;

const writeReader = async (code: string) => {
  await writeFile(modulePath, code);
  vi.stubEnv('PI_LOBE_CODE_OWNER_READER_SHA256', createHash('sha256').update(code).digest('hex'));
};

beforeEach(async () => {
  await mkdir(path.join(process.cwd(), 'tmp'), { recursive: true });
  directory = await mkdtemp(path.join(process.cwd(), 'tmp/task-owner-reader-'));
  contractFile = path.join(directory, 'private-contract.json');
  modulePath = path.join(directory, 'pi-code-stage-reader.mjs');
  await writeFile(contractFile, JSON.stringify(contract()), { mode: 0o600 });
  await writeReader(source);
  vi.stubEnv('PI_LOBE_CODE_OWNER_READER', modulePath);
  vi.stubEnv('PI_LOBE_CODE_OWNER_CONTRACT', contractFile);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

// This exercises the real host filesystem/process seam with synthetic code only.
// It is not a fake substitute for the original Vista reader's evidence tests or live readback.
describe('explicit local owner-reader host boundary', () => {
  it('is inert with no explicitly configured capability', async () => {
    vi.stubEnv('PI_LOBE_CODE_OWNER_READER', undefined);
    expect(await new TaskEngineeringOwnerReader().read(taskId, linked)).toEqual({
      status: 'unavailable',
      reason: 'not-configured',
    });
  });

  it('projects only a matching closed read-only observation, independent of JSON key order', async () => {
    const result = await new TaskEngineeringOwnerReader().read(taskId, linked);
    expect(result).toMatchObject({
      status: 'observed',
      source: 'pi-vista-original-reader',
      repository: 'chenhaoxiang/pi-lobehub',
      pullRequest: 6,
      headSha: head,
      scope: 'source-shared-delivery-only',
      authorization: 'none',
      phase: 'source-delivery',
    });
    expect(JSON.stringify(result)).not.toContain('private-contract');
    expect(JSON.stringify(result)).not.toContain('synthetic-owner-context');
    expect(JSON.stringify(result)).not.toContain('bodySha256');
  });

  it('refuses another task, unlinked PR, wrong head or wrong owner before source work', async () => {
    await writeReader('throw Error("SOURCE_MUST_NOT_RUN");');
    const reader = new TaskEngineeringOwnerReader();
    expect(await reader.read('task-other', linked)).toMatchObject({ reason: 'binding-mismatch' });
    expect(await reader.read(taskId, [])).toMatchObject({ reason: 'binding-mismatch' });
    expect(await reader.read(taskId, [{ ...linked[0], headSha: 'c'.repeat(40) }])).toMatchObject({
      reason: 'binding-mismatch',
    });
    await writeFile(
      contractFile,
      JSON.stringify({
        ...contract(),
        binding: {
          ...contract().binding,
          workRef: { owner: 'other/owner', kind: 'task', key: taskId },
        },
      }),
    );
    expect(await reader.read(taskId, linked)).toMatchObject({ reason: 'binding-mismatch' });
  });

  it('does not read nonprivate files or export raw source/process errors', async () => {
    await chmod(contractFile, 0o644);
    expect(await new TaskEngineeringOwnerReader().read(taskId, linked)).toEqual({
      status: 'unavailable',
      reason: 'source-unavailable',
    });
    await chmod(contractFile, 0o600);
    await writeReader(
      'export async function readCodeStage(){throw Error("PRIVATE_PATH_OR_TOKEN");}',
    );
    const result = await new TaskEngineeringOwnerReader().read(taskId, linked);
    expect(result).toEqual({ status: 'unavailable', reason: 'source-unavailable' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PATH_OR_TOKEN');
  });

  it('invalidates the observation if the selected private original contract changes mid-read', async () => {
    await writeReader(
      `import {writeFile} from 'node:fs/promises';\n${source.replace('return { progress:', `await writeFile(${JSON.stringify(contractFile)}, '{}'); return { progress:`)}`,
    );
    expect(await new TaskEngineeringOwnerReader().read(taskId, linked)).toEqual({
      status: 'unavailable',
      reason: 'binding-mismatch',
    });
  });

  it('does not execute an entrypoint whose pinned fingerprint no longer matches', async () => {
    const marker = path.join(directory, 'replaced-reader-executed');
    await writeFile(
      modulePath,
      `import {writeFile} from 'node:fs/promises'; await writeFile(${JSON.stringify(marker)}, 'executed');\n${source}`,
    );
    expect(await new TaskEngineeringOwnerReader().read(taskId, linked)).toEqual({
      status: 'unavailable',
      reason: 'source-unavailable',
    });
    await expect(access(marker)).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('does not follow a private-contract symlink or forward ambient credentials/startup hooks', async () => {
    const alias = path.join(directory, 'alias.json');
    await symlink(contractFile, alias);
    vi.stubEnv('PI_LOBE_CODE_OWNER_CONTRACT', alias);
    expect(await new TaskEngineeringOwnerReader().read(taskId, linked)).toMatchObject({
      status: 'unavailable',
    });
    vi.stubEnv('PI_LOBE_CODE_OWNER_CONTRACT', contractFile);
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-not-a-real-key');
    vi.stubEnv('GH_TOKEN', 'synthetic-not-a-real-token');
    vi.stubEnv('NODE_OPTIONS', '--require /synthetic/never-load');
    await writeReader(
      source.replace(
        'return { progress:',
        'if(process.env.OPENAI_API_KEY || process.env.GH_TOKEN || process.env.NODE_OPTIONS) throw Error("UNEXPECTED_AMBIENT_STATE"); return { progress:',
      ),
    );
    expect(await new TaskEngineeringOwnerReader().read(taskId, linked)).toMatchObject({
      status: 'observed',
      authorization: 'none',
    });
  });

  it('does not turn a null, foreign binding or authorizing payload into an observation', async () => {
    for (const patch of [
      'return {progress:null};',
      source
        .slice(source.indexOf('return '), source.lastIndexOf('}'))
        .replace("authorization:'none'", "authorization:'allowed'"),
      source
        .slice(source.indexOf('return '), source.lastIndexOf('}'))
        .replace('key:c.binding.workRef.key', "key:'task-foreign'"),
    ]) {
      await writeReader(`export async function readCodeStage(c) { ${patch} }`);
      expect(await new TaskEngineeringOwnerReader().read(taskId, linked)).toMatchObject({
        status: 'unavailable',
      });
    }
  });
});
