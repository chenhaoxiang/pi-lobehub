import { randomUUID } from 'node:crypto';

import type { AskUserBridge } from '../askUser/AskUserBridge';
import type { PiExtensionUiResponse } from './piRpcProtocol';
import type { PiRpcUiHandler } from './piRpcUiRequests';

/** Reuse the durable question path, without another tool registry or answer store. */
export const createPiRpcQuestionHandler =
  (bridge: AskUserBridge): PiRpcUiHandler =>
  async (request, signal) => {
    const { method } = request;
    if (!['select', 'confirm', 'input', 'editor'].includes(method) || signal.aborted) return;
    const question = [
      request.title || 'Pi input',
      request.message,
      request.placeholder,
      method === 'editor' ? request.prefill : undefined,
    ]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .join('\n\n');
    const choices =
      method === 'confirm'
        ? [
            { id: 'pi-confirm-yes', label: 'Yes' },
            { id: 'pi-confirm-no', label: 'No' },
          ]
        : method === 'select'
          ? request.options?.map((label, index) => ({ id: `pi-option-${index}`, label }))
          : [];
    // Match the existing durable Review schema, never truncate provider choices.
    if (
      !choices ||
      question.length > 4000 ||
      choices.length > 16 ||
      choices.some(({ label }) => typeof label !== 'string' || !label || label.length > 200) ||
      (method === 'select' && choices.length === 0)
    )
      return;

    const toolCallId = `pi-ui-${request.id}-${randomUUID()}`;
    const cancel = () => bridge.cancel(toolCallId, 'session_ended');
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const answer = await bridge.pending(
        {
          arguments: {
            autoSubmitOnTimeout: false,
            questions: [
              {
                header: `Pi ${method}`,
                multiSelect: false,
                options: choices,
                question,
              },
            ],
          },
          interactionKind: method === 'confirm' ? 'permission' : 'question',
          toolCallId,
        },
        { timeoutMs: request.timeout },
      );
      if (signal.aborted || answer.cancelled || !answer.result || typeof answer.result !== 'object')
        return;
      const result = answer.result as Record<string, unknown>;
      const value =
        result[question] ??
        (method === 'input' || method === 'editor' ? result.__freeform__ : undefined);
      const response: PiExtensionUiResponse = { id: request.id, type: 'extension_ui_response' };
      // Permission choices round-trip exact stable ids; arbitrary text is not consent.
      if (method === 'confirm') {
        if (value !== 'pi-confirm-yes' && value !== 'pi-confirm-no') return;
        return { ...response, confirmed: value === 'pi-confirm-yes' };
      }
      if (typeof value !== 'string') return;
      if (method === 'select') {
        // Explicit ids also disable the legacy form's auto-select-on-timeout.
        const index = choices.findIndex((choice) => choice.id === value);
        if (index < 0 || !request.options) return;
        return { ...response, value: request.options[index] };
      }
      return { ...response, value };
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  };
