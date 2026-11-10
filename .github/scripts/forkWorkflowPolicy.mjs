import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { parse } = createRequire(import.meta.url)('yaml');
const upstreamGuard = "github.repository == 'lobehub/lobehub'";
const forkGuard = "github.repository == 'chenhaoxiang/pi-lobehub'";

// The outer owner condition must dominate the complete original expression.
export const hasOwnerGuard = (value, guard) => {
  if (typeof value !== 'string') return false;
  let expression = value.trim();
  if (expression.startsWith('${{') && expression.endsWith('}}'))
    expression = expression.slice(3, -2).trim();
  if (expression === guard) return true;
  if (!expression.startsWith(`${guard} && (`)) return false;

  let depth = 0;
  let quoted = false;
  const suffix = expression.slice(`${guard} && `.length);
  for (let index = 0; index < suffix.length; index++) {
    const char = suffix[index];
    if (char === "'") {
      if (quoted && suffix[index + 1] === "'") index++;
      else quoted = !quoted;
    } else if (!quoted && char === '(') depth++;
    else if (!quoted && char === ')') {
      depth--;
      if (depth < 0 || (depth === 0 && index !== suffix.length - 1)) return false;
    }
  }
  return !quoted && depth === 0;
};

export const inspectWorkflow = (filename, workflow) => {
  const errors = [];
  const jobs = Object.entries(workflow?.jobs ?? {});
  if (jobs.length === 0) return [`${filename}: workflow has no jobs`];
  const fork = filename === 'pi-fork-check.yml';
  for (const [id, job] of jobs) {
    if (!hasOwnerGuard(job.if, fork ? forkGuard : upstreamGuard))
      errors.push(`${filename}:${id}: missing dominating repository guard`);
    if (fork && (job.permissions === 'write-all' ||
        Object.values(job.permissions ?? {}).some((permission) => permission === 'write')))
      errors.push(`${filename}:${id}: fork validation cannot grant write permissions`);
  }
  if (!fork) return errors;

  const events = workflow.on ?? {};
  if (Object.keys(events).some((event) => !['push', 'pull_request', 'workflow_dispatch'].includes(event)))
    errors.push(`${filename}: unapproved validation event`);
  for (const event of ['push', 'pull_request']) {
    if (JSON.stringify(events[event]?.branches) !== JSON.stringify(['main']))
      errors.push(`${filename}: ${event} must target main only`);
  }
  if (workflow.permissions?.contents !== 'read' ||
      Object.values(workflow.permissions).some((permission) => permission === 'write'))
    errors.push(`${filename}: validation requires read-only contents permission`);
  if (/\bsecrets[.\[]/.test(JSON.stringify(workflow)))
    errors.push(`${filename}: validation cannot require repository secrets`);
  return errors;
};

export const auditWorkflows = (directory) => {
  const files = readdirSync(directory).filter((file) => /\.ya?ml$/.test(file));
  const errors = [];
  if (!files.includes('pi-fork-check.yml')) errors.push('fork validation workflow is missing');
  for (const filename of files) {
    try {
      errors.push(...inspectWorkflow(filename, parse(readFileSync(path.join(directory, filename), 'utf8'))));
    } catch (error) {
      errors.push(`${filename}: ${error.message}`);
    }
  }
  return { files: files.length, errors };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditWorkflows(path.resolve('.github/workflows'));
  for (const error of result.errors) console.error(error);
  console.log(`Audited ${result.files} workflows; ${result.errors.length} policy errors`);
  process.exitCode = result.errors.length ? 1 : 0;
}
