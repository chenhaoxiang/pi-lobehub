import { afterEach, describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import type { PiExtensionUiRequest } from './piRpcProtocol';
import { createPiRpcQuestionHandler } from './piRpcQuestionBridge';

const fixture = () => {
  const bridge = new AskUserBridge('op-pi', { identifier: 'claude-code', provider: 'pi' });
  return {
    bridge,
    events: bridge.events()[Symbol.asyncIterator](),
    handler: createPiRpcQuestionHandler(bridge),
  };
};
const request = (overrides: Partial<PiExtensionUiRequest> = {}): PiExtensionUiRequest => ({
  id: 'native-request-1',
  method: 'select',
  options: ['A', 'B'],
  title: 'Choose',
  type: 'extension_ui_request',
  ...overrides,
});
afterEach(() => vi.useRealTimers());

describe('Pi RPC question bridge', () => {
  it.each(['select', 'input', 'editor'] as const)(
    'round-trips %s through the existing operation bridge',
    async (method) => {
      const { bridge, events, handler } = fixture();
      const answer = handler(request({ method }), new AbortController().signal);
      const event = (await events.next()).value!;
      expect(JSON.parse(event.data.arguments).autoSubmitOnTimeout).toBe(false);
      expect(event).toMatchObject({
        operationId: 'op-pi',
        data: { provider: 'pi', identifier: 'claude-code' },
        type: 'agent_intervention_request',
      });
      const { questions } = JSON.parse(event.data.arguments);
      bridge.resolve(event.data.toolCallId, {
        result: { [questions[0].question]: method === 'select' ? 'pi-option-1' : 'typed answer' },
      });
      await expect(answer).resolves.toEqual({
        id: 'native-request-1',
        type: 'extension_ui_response',
        value: method === 'select' ? 'B' : 'typed answer',
      });
      expect(bridge.pendingCount).toBe(0);
      bridge.cancelAll();
    },
  );

  it.each([
    ['pi-confirm-yes', true],
    ['pi-confirm-no', false],
    ['Yes', undefined],
    ['arbitrary approval', undefined],
  ] as const)('confirm accepts only the exact native choice %s', async (selection, expected) => {
    const { bridge, events, handler } = fixture();
    const answer = handler(
      request({ method: 'confirm', message: 'Proceed?' }),
      new AbortController().signal,
    );
    const event = (await events.next()).value!;
    expect(event.data.interactionKind).toBe('permission');
    const { questions } = JSON.parse(event.data.arguments);
    bridge.resolve(event.data.toolCallId, { result: { [questions[0].question]: selection } });
    await expect(answer).resolves.toEqual(
      expected === undefined
        ? undefined
        : { confirmed: expected, id: 'native-request-1', type: 'extension_ui_response' },
    );
    bridge.cancelAll();
  });

  it('cannot deliver a late old answer into a replacement request, even with a reused native id', async () => {
    const { bridge, events, handler } = fixture();
    const abort = new AbortController();
    const first = handler(request(), abort.signal);
    const old = (await events.next()).value!;
    abort.abort();
    await expect(first).resolves.toBeUndefined();
    await events.next(); // terminal cancellation
    const second = handler(request(), new AbortController().signal);
    const current = (await events.next()).value!;
    expect(current.data.toolCallId).not.toBe(old.data.toolCallId);
    bridge.resolve(old.data.toolCallId, { result: { Choose: 'A' } });
    expect(bridge.pendingCount).toBe(1);
    bridge.resolve(current.data.toolCallId, { result: { Choose: 'pi-option-1' } });
    await expect(second).resolves.toMatchObject({ value: 'B' });
    bridge.cancelAll();
  });

  it.each(['cancel', 'timeout', 'disconnect'] as const)(
    'releases the blocked callback on %s',
    async (path) => {
      vi.useFakeTimers();
      const { bridge, events, handler } = fixture();
      const answer = handler(request({ timeout: 100 }), new AbortController().signal);
      const event = (await events.next()).value!;
      if (path === 'cancel') bridge.cancel(event.data.toolCallId);
      else if (path === 'disconnect') bridge.cancelAll();
      else await vi.advanceTimersByTimeAsync(100);
      await expect(answer).resolves.toBeUndefined();
      expect(bridge.pendingCount).toBe(0);
      bridge.cancelAll();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not turn malformed or off-list answers into a select response', async () => {
    for (const result of [
      { Choose: 'not an option' },
      { Choose: ['A', 'B'] },
      { __freeform__: 'A' },
      null,
    ]) {
      const { bridge, events, handler } = fixture();
      const answer = handler(request(), new AbortController().signal);
      const event = (await events.next()).value!;
      bridge.resolve(event.data.toolCallId, { result });
      await expect(answer).resolves.toBeUndefined();
      bridge.cancelAll();
    }
  });
});
