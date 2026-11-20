// @vitest-environment node
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';

import journal from '../migrations/meta/_journal.json';

const migrationsFolder = path.join(__dirname, '../migrations');
const reviewMigrationTag = '0213_acceptance_review_rounds';
const temporaryFolders: string[] = [];

const historicalMigrationsFolder = async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'acceptance-review-migration-'));
  temporaryFolders.push(folder);
  await mkdir(path.join(folder, 'meta'));
  const migrationIndex = journal.entries.findIndex(({ tag }) => tag === reviewMigrationTag);
  if (migrationIndex < 0) throw new Error(`Missing ${reviewMigrationTag} journal entry`);
  const entries = journal.entries.slice(0, migrationIndex);
  await writeFile(path.join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  await Promise.all(
    entries.map(({ tag }) =>
      copyFile(path.join(migrationsFolder, `${tag}.sql`), path.join(folder, `${tag}.sql`)),
    ),
  );
  return folder;
};

const reviewTables = ['acceptance_reviews', 'acceptance_review_marks'];

describe('acceptance review round migration', () => {
  afterAll(async () => {
    await Promise.all(
      temporaryFolders.map((folder) => rm(folder, { recursive: true, force: true })),
    );
  });

  it('creates the round and mark contract on a fresh database', async () => {
    const client = new PGlite({ extensions: { vector } });
    try {
      await migrate(drizzle({ client }), { migrationsFolder });

      for (const table of reviewTables) {
        expect((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rows).toEqual([]);
      }
      expect(
        (
          await client.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'acceptance_comments' AND column_name = 'review_mark_id'`,
          )
        ).rows,
      ).toEqual([{ column_name: 'review_mark_id' }]);
      expect(
        (
          await client.query(
            `SELECT indexname FROM pg_indexes
             WHERE indexname IN ('acceptance_review_marks_review_id_client_id_unique',
               'acceptance_review_marks_review_id_seq_unique')
             ORDER BY indexname`,
          )
        ).rows,
      ).toEqual([
        { indexname: 'acceptance_review_marks_review_id_client_id_unique' },
        { indexname: 'acceptance_review_marks_review_id_seq_unique' },
      ]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('upgrades an existing acceptance and verify chain without changing its rows', async () => {
    const client = new PGlite({ extensions: { vector } });
    try {
      const db = drizzle({ client });
      await migrate(db, { migrationsFolder: await historicalMigrationsFolder() });
      await client.exec(`
        INSERT INTO users (id) VALUES ('review-migration-user');
        INSERT INTO acceptances (id, user_id, subject_type, subject_id, status, metadata)
          VALUES ('00000000-0000-0000-0000-000000000101', 'review-migration-user', 'task',
            'review-migration-task', 'pending', '{"legacy":true}');
        INSERT INTO verify_runs (id, user_id, acceptance_id, round_index, source, status, metadata)
          VALUES ('00000000-0000-0000-0000-000000000102', 'review-migration-user',
            '00000000-0000-0000-0000-000000000101', 1, 'agent', 'completed', '{"checks":2}');
      `);
      const before = await Promise.all(
        ['acceptances', 'verify_runs'].map(
          async (table) =>
            (await client.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY id`)).rows,
        ),
      );

      await migrate(db, { migrationsFolder });

      const after = await Promise.all(
        ['acceptances', 'verify_runs'].map(
          async (table) =>
            (await client.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY id`)).rows,
        ),
      );
      expect(after).toEqual(before);
      expect(
        (await client.query('SELECT COUNT(*)::int AS count FROM acceptance_reviews')).rows,
      ).toEqual([{ count: 0 }]);

      const migrationIndex = journal.entries.findIndex(({ tag }) => tag === reviewMigrationTag);
      const migration = readMigrationFiles({ migrationsFolder })[migrationIndex];
      for (const statement of migration.sql) await client.query(statement);
      expect(
        (await client.query('SELECT COUNT(*)::int AS count FROM acceptance_reviews')).rows,
      ).toEqual([{ count: 0 }]);
    } finally {
      await client.close();
    }
  }, 60_000);
});
