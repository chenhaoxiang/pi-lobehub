import { describe, expect, it } from 'vitest';

import { AskUserBridge } from './AskUserBridge';

describe('producer validation before terminal ACK', () => {
  it('rejects an invalid answer as cancellation before emitting any resolved ACK', async () => {
    const bridge = new AskUserBridge('operation', { provider: 'pi' });
    const events = bridge.events()[Symbol.asyncIterator]();
    const pending = bridge.pending({
      arguments: {},
      toolCallId: 'question',
      validateResult: (result) => result === 'exact-id',
    });
    await events.next();
    bridge.resolve('question', {
      result: 'arbitrary custom text',
      resolutionRequestId: 'response-id',
    });
    await expect(pending).resolves.toMatchObject({ cancelled: true });
    expect((await events.next()).value).toMatchObject({
      type: 'agent_intervention_response',
      data: {
        cancelled: true,
        producerAck: true,
        result: undefined,
        resolutionRequestId: 'response-id',
      },
    });
    bridge.cancelAll();
  });
});
