// @vitest-environment node
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import journal from '../migrations/meta/_journal.json';

const migrationsFolder = path.join(__dirname, '../migrations');
const TAG = '0214_task_topic_stale_settlement_fences';
const FINALIZER_TAG = '0215_task_topic_stale_settlement_fences';

/**
 * The migration is intentionally replayed from the previous journal boundary:
 * a deployment may retry a migration after the process dies after DDL commit.
 */
describe('TaskTopic stale-settlement fence migration', () => {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client });
  let historicalFolder: string;

  beforeAll(async () => {
    historicalFolder = await mkdtemp(path.join(tmpdir(), 'lobe-task-topic-fence-migration-'));
    await mkdir(path.join(historicalFolder, 'meta'));
    const last = journal.entries.findIndex(({ tag }) => tag === TAG);
    const entries = journal.entries.slice(0, last);
    await Promise.all([
      writeFile(
        path.join(historicalFolder, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries }),
      ),
      ...entries.map(({ tag }) =>
        copyFile(
          path.join(migrationsFolder, `${tag}.sql`),
          path.join(historicalFolder, `${tag}.sql`),
        ),
      ),
    ]);
    await migrate(db, { migrationsFolder: historicalFolder });
    await client.query(`INSERT INTO users (id) VALUES ('task-topic-fence-user')`);
    await client.query(
      `INSERT INTO tasks (id, identifier, seq, created_by_user_id, instruction)
       VALUES ('task-topic-fence-task', 'T-FENCE', 1, 'task-topic-fence-user', 'test')`,
    );
    await client.query(
      `INSERT INTO topics (id, user_id) VALUES ('task-topic-fence-topic', 'task-topic-fence-user')`,
    );
    await client.query(
      `INSERT INTO task_topics (task_id, topic_id, user_id, seq, operation_id)
       VALUES ('task-topic-fence-task', 'task-topic-fence-topic', 'task-topic-fence-user', 4, 'op-fence')`,
    );
    await migrate(db, { migrationsFolder });
  }, 30_000);

  afterAll(async () => {
    await client.close();
    if (historicalFolder) await rm(historicalFolder, { force: true, recursive: true });
  });

  it('adds the fence column without losing existing task-topic rows', async () => {
    const rows = await client.query<{ operation_id: string; stale_settlement_fences: unknown[] }>(
      `SELECT operation_id, stale_settlement_fences
       FROM task_topics WHERE id = (SELECT id FROM task_topics LIMIT 1)`,
    );
    expect(rows.rows[0]).toMatchObject({ operation_id: 'op-fence', stale_settlement_fences: [] });
  });

  it('replays the migration idempotently and preserves fence data', async () => {
    await client.query(
      `UPDATE task_topics
       SET stale_settlement_fences = $1::jsonb`,
      [
        JSON.stringify([
          {
            attempt: 4,
            operationId: 'op-fence',
            settledAt: '2026-11-21T00:00:00.000Z',
            taskId: 'task-topic-fence-task',
            topicId: 'task-topic-fence-topic',
          },
        ]),
      ],
    );
    await client.query(
      `UPDATE task_topics
       SET verify_finalizer_claim = $1::jsonb`,
      [
        JSON.stringify({
          claimedAt: '2026-11-21T00:00:00.000Z',
          operationId: 'op-fence',
          taskId: 'task-topic-fence-task',
          topicId: 'task-topic-fence-topic',
        }),
      ],
    );
    const before = await client.query(`SELECT * FROM task_topics`);
    const entry = journal.entries.find(({ tag }) => tag === FINALIZER_TAG);
    const migration = readMigrationFiles({ migrationsFolder }).find(
      ({ folderMillis }) => folderMillis === entry?.when,
    );
    if (!migration) throw new Error('TaskTopic fence migration not found');
    await db.transaction(async (tx) => {
      for (const statement of migration.sql) await tx.execute(statement);
    });
    const after = await client.query(`SELECT * FROM task_topics`);
    expect(after.rows).toEqual(before.rows);
  });
});
