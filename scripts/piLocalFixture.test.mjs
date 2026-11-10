import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = path.join(root, 'scripts/piLocalFixture.mjs');
const run = (cwd, action, env = {}) =>
  spawnSync(process.execPath, [entry, action], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
const fixture = () => {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const dir = mkdtempSync(path.join(root, 'tmp/pi-fixture-test-'));
  mkdirSync(path.join(dir, '.agents/acceptance/scripts'), { recursive: true });
  writeFileSync(
    path.join(dir, '.agents/acceptance/scripts/init-dev-env.sh'),
    '# isolated marker only\n',
  );
  return dir;
};

test('prepares private synthetic configuration without printing secrets or replacing it', () => {
  const dir = fixture();
  try {
    const prepared = run(dir, 'prepare');
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.ok(!/sk-lh-|BEGIN .*KEY|JWKS_KEY=/.test(prepared.stdout));
    const privateDir = path.join(dir, 'keys-local/pi-local-validation');
    assert.equal(statSync(privateDir).mode & 0o077, 0);
    const first = readFileSync(path.join(privateDir, 'source.env'), 'utf8');
    assert.match(first, /export DEV_HOST='127\.0\.0\.1'/);
    for (const file of ['source.env', 'gateway.env', 'public-jwks.json'])
      assert.equal(statSync(path.join(privateDir, file)).mode & 0o077, 0);
    assert.equal(run(dir, 'prepare').status, 0);
    assert.equal(readFileSync(path.join(privateDir, 'source.env'), 'utf8'), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a symlinked private directory without touching the foreign target', () => {
  const dir = fixture();
  try {
    const foreign = path.join(dir, 'foreign');
    mkdirSync(foreign);
    writeFileSync(path.join(foreign, 'preserve'), 'unchanged');
    symlinkSync(foreign, path.join(dir, 'keys-local'));
    assert.notEqual(run(dir, 'prepare').status, 0);
    assert.equal(readFileSync(path.join(foreign, 'preserve'), 'utf8'), 'unchanged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preserves public configuration when source.env is missing, including repeated attempts', () => {
  const dir = fixture();
  try {
    const privateDir = path.join(dir, 'keys-local/pi-local-validation');
    mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    for (const file of ['public-jwks.json', 'gateway.env'])
      writeFileSync(path.join(privateDir, file), `preserve-${file}`, { mode: 0o600 });
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.notEqual(run(dir, 'prepare').status, 0);
      assert.equal(existsSync(path.join(privateDir, 'source.env')), false);
      for (const file of ['public-jwks.json', 'gateway.env'])
        assert.equal(readFileSync(path.join(privateDir, file), 'utf8'), `preserve-${file}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fails closed on partial state and nonlocal connect targets', () => {
  const dir = fixture();
  try {
    mkdirSync(path.join(dir, 'keys-local/pi-local-validation'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dir, 'keys-local/pi-local-validation/source.env'), 'preserve\n', {
      mode: 0o600,
    });
    assert.notEqual(run(dir, 'prepare').status, 0);
    assert.equal(
      readFileSync(path.join(dir, 'keys-local/pi-local-validation/source.env'), 'utf8'),
      'preserve\n',
    );
    const invalid = run(dir, 'connect', {
      JWKS_KEY: 'not a key',
      LOBEHUB_SERVER: 'https://app.lobehub.com',
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /loopback HTTP only/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
