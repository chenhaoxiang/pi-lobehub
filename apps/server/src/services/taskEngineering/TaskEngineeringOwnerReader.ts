import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import type { TaskEngineeringOwnerObservation, TaskEngineeringPullRequest } from '@lobechat/types';
import debug from 'debug';

const MAX_CONTRACT_BYTES = 64 * 1024;
const OWNER = 'chenhaoxiang/pi-lobehub';
const log = debug('lobe-task-engineering:owner-read');

// One configured host capability, one process per backend instance. No fact cache or queue.
let activeRead: { key: string; promise: Promise<string> } | undefined;
const joinedRead = (key: string, start: () => Promise<string>): Promise<string> => {
  if (activeRead)
    return activeRead.key === key
      ? activeRead.promise
      : Promise.reject(new Error('owner-source-read-busy'));
  const pending = start();
  activeRead = { key, promise: pending };
  return pending.finally(() => {
    if (activeRead?.promise === pending) activeRead = undefined;
  });
};

// This is fixed host code, not a command or JS accepted from a web request.
// The configured module is the original Vista reader, not a model-result parser.
const PROGRAM = `
import { pathToFileURL } from 'node:url';
let bytes = '';
for await (const chunk of process.stdin) bytes += chunk;
const reader = await import(pathToFileURL(process.argv[1]).href);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 55000);
try {
  const result = await reader.readCodeStage(JSON.parse(bytes), { signal: controller.signal });
  process.stdout.write(JSON.stringify(result.progress));
} finally { clearTimeout(timer); }
`;

const readHostFile = async (path: string, privateFile = true): Promise<string> => {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size > MAX_CONTRACT_BYTES ||
      (privateFile && (stat.mode & 0o077) !== 0) ||
      (!privateFile && (stat.mode & 0o022) !== 0) ||
      (process.getuid && stat.uid !== process.getuid() && (privateFile || stat.uid !== 0))
    )
      throw new Error('owner-contract-unavailable');
    const buffer = Buffer.alloc(MAX_CONTRACT_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_CONTRACT_BYTES || bytesRead !== stat.size)
      throw new Error('owner-contract-unavailable');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
};

const unavailable = (
  reason: 'binding-mismatch' | 'not-configured' | 'source-unavailable',
): TaskEngineeringOwnerObservation => ({ status: 'unavailable', reason });

const sameBinding = (left: any, right: any) =>
  ['stageId', 'runId', 'sessionId', 'revision', 'headSha'].every(
    (key) => left?.[key] === right?.[key],
  ) && ['owner', 'kind', 'key'].every((key) => left?.workRef?.[key] === right?.workRef?.[key]);

/** Explicit local host capability. Neither paths nor arbitrary source metadata enter the response. */
export class TaskEngineeringOwnerReader {
  async read(
    taskId: string,
    pullRequests: TaskEngineeringPullRequest[],
  ): Promise<TaskEngineeringOwnerObservation> {
    const startedAt = Date.now();
    let stage = 'configuration';
    const failed = (reason: 'binding-mismatch' | 'source-unavailable') => {
      log('unavailable %o', { stage, elapsedMs: Date.now() - startedAt });
      return unavailable(reason);
    };
    const modulePath = process.env.PI_LOBE_CODE_OWNER_READER;
    const contractFile = process.env.PI_LOBE_CODE_OWNER_CONTRACT;
    const readerDigest = process.env.PI_LOBE_CODE_OWNER_READER_SHA256;
    if (!modulePath || !contractFile || !readerDigest) return unavailable('not-configured');
    if (
      !path.isAbsolute(modulePath) ||
      !path.isAbsolute(contractFile) ||
      !modulePath.endsWith('/pi-code-stage-reader.mjs') ||
      !/^[a-f0-9]{64}$/.test(readerDigest)
    )
      return failed('source-unavailable');
    try {
      stage = 'contract';
      const before = await readHostFile(contractFile);
      const contract = JSON.parse(before);
      stage = 'binding';
      const binding = contract?.binding;
      const work = binding?.workRef;
      const selected = pullRequests.find(
        (pr) => pr.repository === contract.repository && pr.number === contract.pullRequest,
      );
      if (
        work?.owner !== OWNER ||
        work.kind !== 'task' ||
        work.key !== taskId ||
        binding.stageId !== 'source-shared-delivery' ||
        typeof binding.headSha !== 'string' ||
        !/^[a-f0-9]{40}$/.test(binding.headSha) ||
        !selected ||
        (selected.headSha && selected.headSha !== binding.headSha)
      )
        return failed('binding-mismatch');
      stage = 'reader-entry';
      const readerBytes = await readHostFile(modulePath, false);
      if (createHash('sha256').update(readerBytes, 'utf8').digest('hex') !== readerDigest)
        return failed('source-unavailable');
      const key = createHash('sha256')
        .update(modulePath)
        .update(contractFile)
        .update(readerDigest)
        .update(before)
        .digest('hex');
      stage = 'original-read';
      const stdout = await joinedRead(
        key,
        () =>
          new Promise<string>((resolve, reject) => {
            const child = execFile(
              process.execPath,
              ['--input-type=module', '-e', PROGRAM, modulePath],
              {
                timeout: 60_000,
                maxBuffer: 16 * 1024,
                env: {
                  HOME: process.env.HOME,
                  PATH: process.env.PATH,
                  TMPDIR: process.env.TMPDIR,
                  LANG: 'C',
                  LC_ALL: 'C',
                  NODE_ENV: process.env.NODE_ENV,
                  NEXT_PUBLIC_DEVELOPER_DEBUG: '0',
                  NEXT_PUBLIC_I18N_DEBUG: '0',
                  NEXT_PUBLIC_I18N_DEBUG_BROWSER: '0',
                  NEXT_PUBLIC_I18N_DEBUG_SERVER: '0',
                  GH_PROMPT_DISABLED: '1',
                  GH_PAGER: 'cat',
                  ...(process.env.GH_CONFIG_DIR
                    ? { GH_CONFIG_DIR: process.env.GH_CONFIG_DIR }
                    : {}),
                },
              },
              (error, stdout) => (error ? reject(error) : resolve(stdout)),
            );
            child.stdin?.on('error', () => undefined);
            child.stdin?.end(before);
          }),
      );
      stage = 'reread';
      // A rewritten contract cannot relabel another read or change required originals mid-call.
      if (
        before !== (await readHostFile(contractFile)) ||
        readerBytes !== (await readHostFile(modulePath, false))
      )
        return failed('binding-mismatch');
      stage = 'parse';
      const row = JSON.parse(stdout);
      stage = 'projection';
      if (
        !row ||
        row.repository !== contract.repository ||
        row.pullRequest !== contract.pullRequest ||
        !sameBinding(row.binding, binding) ||
        row.authorization !== 'none' ||
        row.readOnly !== true ||
        row.executable !== false ||
        !Number.isSafeInteger(row.observedAt) ||
        row.observedAt < 0 ||
        typeof row.phase !== 'string' ||
        typeof row.waitReason !== 'string' ||
        typeof row.nextAction !== 'string' ||
        !/^[a-z-]{1,64}$/.test(row.phase) ||
        !/^[a-z_]{1,64}$/.test(row.waitReason) ||
        !/^[a-z_]{1,64}$/.test(row.nextAction)
      )
        return failed('source-unavailable');
      log('observed %o', { elapsedMs: Date.now() - startedAt });
      return {
        status: 'observed',
        source: 'pi-vista-original-reader',
        sourceType: contract.repositoryReview ? 'repository-review' : 'owner-gate',
        scope: 'source-shared-delivery-only',
        authorization: 'none',
        readOnly: true,
        repository: row.repository,
        pullRequest: row.pullRequest,
        headSha: binding.headSha,
        observedAt: row.observedAt,
        phase: row.phase,
        waitReason: row.waitReason,
        nextAction: row.nextAction,
      };
    } catch {
      // Diagnostics contain only our static stage and elapsed time, never raw errors or originals.
      return failed('source-unavailable');
    }
  }
}
