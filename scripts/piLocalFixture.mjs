import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
if (
  !['prepare', 'connect'].includes(process.argv[2]) ||
  !existsSync(path.join(root, '.agents/acceptance/scripts/init-dev-env.sh'))
)
  throw new Error('Run prepare|connect from the reviewed LobeHub worktree root');
const directory = path.join(root, 'keys-local/pi-local-validation');
const envFile = path.join(directory, 'source.env');
const safeDirectory = (directory) => {
  if (
    existsSync(directory) &&
    (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
  )
    throw new Error('Fixture directory must not be a symlink');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
};
safeDirectory(path.join(root, 'keys-local'));
safeDirectory(directory);
safeDirectory(path.join(root, 'tmp'));
safeDirectory(path.join(root, 'tmp/pi-local'));

if (process.argv[2] === 'prepare') {
  const files = ['source.env', 'public-jwks.json', 'gateway.env'];
  if (files.some((file) => lstatSync(path.join(directory, file), { throwIfNoEntry: false }))) {
    for (const file of files) {
      const candidate = path.join(directory, file);
      if (
        !existsSync(candidate) ||
        !lstatSync(candidate).isFile() ||
        lstatSync(candidate).isSymbolicLink() ||
        lstatSync(candidate).mode & 0o077
      )
        throw new Error(
          'Existing fixture must contain private regular configuration files; preserve and inspect partial state',
        );
    }
    console.log('Existing private fixture retained; no secret value printed or replaced.');
    process.exit(0);
  }
  const instance = createHash('sha256').update(root).digest('hex').slice(0, 8);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = (key) => ({ ...key.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
  const publicJwks = JSON.stringify({ keys: [jwk(publicKey)] });
  const token = randomBytes(32).toString('hex');
  const env = {
    PI_LOCAL_INSTANCE: instance,
    DB_CONTAINER: `pi-lobehub-${instance}-postgres`,
    DB_PORT: '127.0.0.1:54321',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54321/postgres',
    REDIS_CONTAINER: `pi-lobehub-${instance}-redis`,
    REDIS_PORT: '127.0.0.1:63821',
    REDIS_URL: 'redis://127.0.0.1:63821',
    AGENT_TESTING_PORTS_FILE: path.join(root, 'tmp/pi-local/ports.env'),
    AGENT_TESTING_DEV_STATE_FILE: path.join(root, 'tmp/pi-local/dev.state'),
    AGENT_TESTING_CLI_ENV_FILE: path.join(directory, 'cli.env'),
    AGENT_TESTING_API_KEY: `sk-lh-${randomBytes(8).toString('hex')}`,
    JWKS_KEY: JSON.stringify({ keys: [jwk(privateKey)] }),
    KEY_VAULTS_SECRET: randomBytes(32).toString('base64'),
    AUTH_SECRET: randomBytes(32).toString('hex'),
    AGENT_GATEWAY_SERVICE_TOKEN: token,
    DEVICE_GATEWAY_SERVICE_TOKEN: token,
    ENABLE_AGENT_GATEWAY: '1',
    AGENT_GATEWAY_URL: 'http://localhost:18787',
    DEVICE_GATEWAY_URL: 'http://localhost:18788',
    AGENT_RUNTIME_MODE: 'queue',
    QSTASH_DEV_PORT: '18081',
    S3_DEV_PORT: '19000',
    S3_DATA_DIR: path.join(root, 'tmp/pi-local/s3'),
    DEV_HOST: '127.0.0.1',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '--max-old-space-size=4096',
  };
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    envFile,
    Object.entries(env)
      .map(([key, value]) => `export ${key}=${quote(value)}`)
      .join('\n') + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  writeFileSync(path.join(directory, 'public-jwks.json'), publicJwks + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  writeFileSync(
    path.join(directory, 'gateway.env'),
    `SERVICE_TOKEN=${token}\nJWKS_PUBLIC_KEY=${publicJwks}\nLOBE_API_BASE_URL=http://host.docker.internal:__PORT__\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Local synthetic fixture prepared under keys-local; no credential values printed.');
} else if (process.argv[2] === 'connect') {
  if (!process.env.JWKS_KEY || !process.env.LOBEHUB_SERVER)
    throw new Error('Source only this fixture env and CLI env in a clean process first');
  const server = new URL(process.env.LOBEHUB_SERVER);
  const gateway = new URL(process.env.DEVICE_GATEWAY_URL || 'http://localhost:18788');
  for (const url of [server, gateway])
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.protocol !== 'http:' ||
      url.username ||
      url.password
    )
      throw new Error('Fixture connect accepts loopback HTTP only');
  const { importJWK, SignJWT } = await import('jose');
  const rsa = JSON.parse(process.env.JWKS_KEY).keys.find((key) => key.kty === 'RSA');
  const jwt = await new SignJWT({ purpose: 'cli-sandbox' })
    .setProtectedHeader({ alg: 'RS256', kid: rsa.kid })
    .setSubject('user_agent_testing_001')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(await importJWK(rsa, 'RS256'));
  const home = path.join(directory, 'home');
  safeDirectory(home);
  const child = spawn(
    'bun',
    [
      'apps/cli/src/index.ts',
      'connect',
      '--gateway',
      gateway.href,
      '--device-id',
      `pi-local-${process.env.PI_LOCAL_INSTANCE || 'validation-01a1'}`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        HOME: home,
        LOBEHUB_SERVER: server.href,
        LOBEHUB_CLI_HOME: '.lobehub-local',
        LOBEHUB_CLI_CHANNEL: 'cli-pi-local-validation',
        LOBEHUB_JWT: jwt,
        NO_COLOR: '1',
      },
      stdio: 'inherit',
    },
  );
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => {
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  throw new Error(
    'Usage: node scripts/piLocalFixture.mjs prepare|connect (local synthetic environment only)',
  );
}
