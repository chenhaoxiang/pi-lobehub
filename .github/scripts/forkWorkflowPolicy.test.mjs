import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { auditWorkflows, hasOwnerGuard, inspectWorkflow } from './forkWorkflowPolicy.mjs';

const upstream = "github.repository == 'lobehub/lobehub'";
const fork = "github.repository == 'chenhaoxiang/pi-lobehub'";
const validation = () => ({
  on: { push: { branches: ['main'] }, pull_request: { branches: ['main'] }, workflow_dispatch: {} },
  permissions: { contents: 'read' },
  jobs: { contracts: { if: fork, steps: [] } },
});

test('requires the owner condition to dominate the complete expression', () => {
  assert.equal(hasOwnerGuard(upstream, upstream), true);
  assert.equal(hasOwnerGuard(`\u0024{{ ${upstream} && (always() || inputs.force) }}`, upstream), true);
  for (const condition of [
    undefined,
    `${upstream} || inputs.force`,
    `${upstream} && (inputs.ready) || always()`,
    `${upstream} && (inputs.ready) && (true)`,
    `${upstream} && (inputs.ready`,
    `contains(github.repository, 'lobehub')`,
  ]) assert.equal(hasOwnerGuard(condition, upstream), false, String(condition));
});

test('an inherited workflow cannot gain an unguarded job', () => {
  assert.deepEqual(inspectWorkflow('release.yml', { jobs: { publish: { if: upstream } } }), []);
  assert.equal(inspectWorkflow('release.yml', {
    jobs: { checked: { if: upstream }, publish: {} },
  }).length, 1);
});

test('fork checks are restricted to read-only main validation events', () => {
  assert.deepEqual(inspectWorkflow('pi-fork-check.yml', validation()), []);
  const write = validation();
  write.jobs.contracts.permissions = { contents: 'write' };
  assert.match(inspectWorkflow('pi-fork-check.yml', write).join('\n'), /write permissions/);
  write.jobs.contracts.permissions = 'write-all';
  assert.match(inspectWorkflow('pi-fork-check.yml', write).join('\n'), /write permissions/);
  const scheduled = validation();
  scheduled.on.schedule = [{ cron: '* * * * *' }];
  assert.match(inspectWorkflow('pi-fork-check.yml', scheduled).join('\n'), /event/);
  const broad = validation();
  broad.on.pull_request.branches = ['**'];
  assert.match(inspectWorkflow('pi-fork-check.yml', broad).join('\n'), /main only/);
  const secret = validation();
  secret.jobs.contracts.steps = [{ run: 'echo ${{ secrets.RELEASE_TOKEN }}' }];
  assert.match(inspectWorkflow('pi-fork-check.yml', secret).join('\n'), /secrets/);
});

test('reports malformed YAML and a missing fork workflow', () => {
  mkdirSync(path.resolve('tmp'), { recursive: true });
  const directory = mkdtempSync(path.resolve('tmp/fork-policy-'));
  try {
    writeFileSync(path.join(directory, 'release.yml'), 'jobs: [\n');
    const result = auditWorkflows(directory);
    assert.equal(result.files, 1);
    assert.equal(result.errors.length, 2);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('all checked-in workflows preserve the repository isolation boundary', () => {
  const result = auditWorkflows(path.resolve('.github/workflows'));
  assert.deepEqual(result.errors, []);
  assert.ok(result.files > 1);
});
