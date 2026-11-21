ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "stale_settlement_fences" jsonb DEFAULT '[]'::jsonb NOT NULL;
