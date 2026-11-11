import type {
  TaskEngineeringCheck,
  TaskEngineeringPullRequest,
  TaskEngineeringSnapshot,
} from '@lobechat/types';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import { acceptances, scmChangeRequests, tasks } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';
import { taskOwnership } from './task/context';

const PR_LIMIT = 8;
const CHECK_LIMIT = 20;
const isSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{40}$/i.test(value);
const repository = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(value) &&
  !value.endsWith('/.') &&
  !value.endsWith('/..') &&
  value.length <= 200;
const prNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const identity = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`;

/** Existing SCM ingress owns facts. This reader neither imports new evidence nor runs SCM control. */
export class TaskEngineeringModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async read(taskId: string): Promise<TaskEngineeringSnapshot | undefined> {
    const scope = { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
    const visibleTask = async () =>
      this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), taskOwnership(scope)))
        .limit(1);
    if (!(await visibleTask())[0]) return;
    // Only this subject's own scoped acceptance is a link source. Do not read arbitrary metadata.
    const [acceptance] = await this.db
      .select({
        id: acceptances.id,
        links: sql<
          unknown[]
        >`COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', link->'provider', 'repository', link->'repoFullName', 'number', link->'number') ORDER BY ord)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${acceptances.metadata}->'pullRequests') = 'array' THEN ${acceptances.metadata}->'pullRequests' ELSE '[]'::jsonb END)
        WITH ORDINALITY AS link_rows(link, ord) WHERE ord <= ${PR_LIMIT + 1}), '[]'::jsonb)`,
        linkCount: sql<number>`CASE WHEN jsonb_typeof(${acceptances.metadata}->'pullRequests') = 'array' THEN jsonb_array_length(${acceptances.metadata}->'pullRequests') ELSE 0 END`,
      })
      .from(acceptances)
      .where(
        and(
          eq(acceptances.subjectType, 'task'),
          eq(acceptances.subjectId, taskId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, acceptances),
          eq(acceptances.userId, this.userId),
        ),
      )
      .limit(1);

    const rows = await this.db
      .select({
        repository: scmChangeRequests.repoFullName,
        number: scmChangeRequests.number,
        taskId: scmChangeRequests.taskId,
        headSha: scmChangeRequests.headSha,
        ciHeadSha: scmChangeRequests.ciHeadSha,
        ciStatus: scmChangeRequests.ciStatus,
        state: scmChangeRequests.state,
        recordedAt: scmChangeRequests.updatedAt,
        checkCount: sql<number>`CASE WHEN jsonb_typeof(${scmChangeRequests.checks}) = 'array' THEN jsonb_array_length(${scmChangeRequests.checks}) ELSE 0 END`,
        checks: sql<
          TaskEngineeringCheck[]
        >`COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', item->'name', 'appId', item->'appId', 'status', item->'status', 'conclusion', item->'conclusion')) ORDER BY ord)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${scmChangeRequests.checks}) = 'array' THEN ${scmChangeRequests.checks} ELSE '[]'::jsonb END)
        WITH ORDINALITY AS check_rows(item, ord) WHERE ord <= ${CHECK_LIMIT}), '[]'::jsonb)`,
      })
      .from(scmChangeRequests)
      .where(
        and(
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            scmChangeRequests,
          ),
          eq(scmChangeRequests.provider, 'github'),
          sql`${scmChangeRequests.metadata}->'repoPrivate' = 'false'::jsonb`,
          or(
            eq(scmChangeRequests.taskId, taskId),
            acceptance
              ? and(
                  isNull(scmChangeRequests.taskId),
                  eq(scmChangeRequests.acceptanceId, acceptance.id),
                )
              : undefined,
          ),
        ),
      )
      .orderBy(desc(scmChangeRequests.updatedAt), desc(scmChangeRequests.id))
      .limit(PR_LIMIT + 1);
    if (!(await visibleTask())[0]) return;

    const pullRequests: TaskEngineeringPullRequest[] = [];
    const covered = new Set<string>();
    for (const row of rows) {
      if (!repository(row.repository) || !prNumber(row.number)) continue;
      const key = identity(row.repository, row.number);
      if (covered.has(key)) continue;
      covered.add(key);
      const headSha = isSha(row.headSha) ? row.headSha : null;
      const ciHeadSha = isSha(row.ciHeadSha) ? row.ciHeadSha : null;
      const sameHead = !!headSha && headSha === ciHeadSha;
      pullRequests.push({
        binding: row.taskId === taskId ? 'task' : 'acceptance',
        source: 'scm-provider-record',
        repository: row.repository,
        number: row.number,
        url: `https://github.com/${row.repository}/pull/${row.number}`,
        headSha,
        ciHeadSha,
        ciStatus: sameHead ? (row.ciStatus ?? 'unknown') : 'unknown',
        state: row.state,
        recordedAt: row.recordedAt?.toISOString() ?? null,
        recordedCheckCount: sameHead ? row.checkCount : 0,
        checksTruncated: sameHead && row.checkCount > CHECK_LIMIT,
        checks: sameHead
          ? row.checks.map((check) => ({
              name: typeof check.name === 'string' ? check.name.slice(0, 256) : '',
              status: typeof check.status === 'string' ? check.status.slice(0, 64) : 'unknown',
              ...(typeof check.appId === 'string' ? { appId: check.appId.slice(0, 128) } : {}),
              ...(typeof check.conclusion === 'string'
                ? { conclusion: check.conclusion.slice(0, 64) }
                : {}),
            }))
          : [],
      });
    }
    for (const raw of acceptance?.links ?? []) {
      if (!raw || typeof raw !== 'object') continue;
      const link = raw as Record<string, unknown>;
      if (link.provider !== 'github' || !repository(link.repository) || !prNumber(link.number))
        continue;
      const key = identity(link.repository, link.number);
      if (covered.has(key)) continue;
      covered.add(key);
      pullRequests.push({
        binding: 'acceptance',
        source: 'manual-link',
        repository: link.repository,
        number: link.number,
        url: `https://github.com/${link.repository}/pull/${link.number}`,
        headSha: null,
        ciHeadSha: null,
        ciStatus: 'unknown',
        state: null,
        recordedAt: null,
        checks: [],
        checksTruncated: false,
        recordedCheckCount: 0,
      });
    }
    return {
      taskId,
      source: 'existing-scm-and-acceptance-links',
      observedAt: Date.now(),
      gate: 'not-observed',
      prLimit: PR_LIMIT,
      checkLimit: CHECK_LIMIT,
      pullRequests: pullRequests.slice(0, PR_LIMIT),
      truncated:
        rows.length > PR_LIMIT ||
        pullRequests.length > PR_LIMIT ||
        (acceptance?.linkCount ?? 0) > PR_LIMIT + 1,
    };
  }
}
