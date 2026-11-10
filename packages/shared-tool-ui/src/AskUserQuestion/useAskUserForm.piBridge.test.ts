/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../../../heterogeneous-agents/src/askUser/AskUserBridge';
import { createMainAgentRunState, reduceMainAgent } from '../../../heterogeneous-agents/src/mainAgentCoordinator';
import { createPiRpcQuestionHandler } from '../../../heterogeneous-agents/src/rpc/piRpcQuestionBridge';
import { useAskUserForm } from './useAskUserForm';

describe('real shared form → Pi producer → durable terminal consistency', () => {
  it('renders exact-choice policy, accepts only exact ids, and never ACKs an invalid value as resolved', async () => {
    const bridge = new AskUserBridge('op-ui', { provider: 'pi', identifier: 'claude-code' });
    const events = bridge.events()[Symbol.asyncIterator]();
    const handler = createPiRpcQuestionHandler(bridge);
    let id = 0;
    const ctx = { agentId: 'agent', topicId: 'topic', newId: () => `msg_${++id}` };
    const invoke = () => handler({ id: 'native', method: 'select', title: 'Choose', options: ['A', 'B'], type: 'extension_ui_request' }, new AbortController().signal);
    for (const valid of [true, false]) {
      const native = invoke();
      const request = (await events.next()).value!;
      const args = JSON.parse(request.data.arguments);
      const hook = renderHook(() => useAskUserForm({ args, persistedDraft: undefined, writeDraft: vi.fn(), onInteractionAction: async (action) => { bridge.resolve(request.data.toolCallId, { result: action.payload }); } }));
      expect(hook.result.current.allowCustomAnswer).toBe(false);
      if (valid) {
        act(() => hook.result.current.handleToggle(args.questions[0], 'pi-option-1'));
        await act(async () => hook.result.current.handleSubmit());
      } else bridge.resolve(request.data.toolCallId, { result: { Choose: 'forged custom text' } });
      const terminal = (await events.next()).value!;
      let state = createMainAgentRunState('assistant');
      state = reduceMainAgent(state, request, ctx).state;
      state = reduceMainAgent(state, terminal, ctx).state;
      expect(state.interventionsByCallId.get(request.data.toolCallId)?.transition).toBe(valid ? 'resolved' : 'cancelled');
      await expect(native).resolves.toEqual(valid ? { id: 'native', type: 'extension_ui_response', value: 'B' } : undefined);
      hook.unmount();
    }
    bridge.cancelAll();
  });
});
