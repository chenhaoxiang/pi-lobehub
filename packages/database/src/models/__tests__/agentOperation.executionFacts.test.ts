// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, topics, users, workspaces } from '../../schemas';
import { AgentOperationModel } from '../agentOperation';

const db = await getTestDB();
const owner = 'execution-facts-owner';
const other = 'execution-facts-other';

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
});
afterEach(async () => {
  await db.delete(users);
});

describe('AgentOperationModel execution facts', () => {
  it('reads a closed metadata projection without prompts, errors or trace references', async () => {
    const model = new AgentOperationModel(db, owner);
    await model.recordStart({
      operationId: 'facts-own',
      metadata: { privatePrompt: 'not-part-of-status' },
      appContext: { sourceMessageId: 'private-source' },
    });
    const rows = await model.findExecutionFactsByIds(['facts-own']);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['id', 'taskId', 'topicId', 'createdAt', 'startedAt', 'status', 'updatedAt'].sort(),
    );
    expect(rows[0]).toMatchObject({ id: 'facts-own', status: 'running' });
    expect(await model.findExecutionFactsByIds([])).toEqual([]);
    expect(await new AgentOperationModel(db, other).findExecutionFactsByIds(['facts-own'])).toEqual(
      [],
    );
  });

  it('does not expose agent-share visitor operations through a creator-facing graph', async () => {
    await db
      .insert(topics)
      .values({ id: 'facts-visitor-topic', senderId: 'visitor-fixture', userId: owner });
    await db.insert(agentOperations).values({
      id: 'facts-visitor-op',
      status: 'running',
      topicId: 'facts-visitor-topic',
      userId: owner,
    });
    expect(
      await new AgentOperationModel(db, owner).findExecutionFactsByIds(['facts-visitor-op']),
    ).toEqual([]);
  });

  it('keeps workspace and personal operation facts separate', async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Execution facts', slug: randomUUID(), primaryOwnerId: owner })
      .returning();
    const model = new AgentOperationModel(db, owner, workspace.id);
    await model.recordStart({ operationId: 'facts-workspace' });
    expect(await model.findExecutionFactsByIds(['facts-workspace'])).toHaveLength(1);
    expect(
      await new AgentOperationModel(db, owner).findExecutionFactsByIds(['facts-workspace']),
    ).toEqual([]);
  });
});
