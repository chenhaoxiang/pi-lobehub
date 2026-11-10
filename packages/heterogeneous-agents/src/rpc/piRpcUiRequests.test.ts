import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PiExtensionUiRequest, PiExtensionUiResponse } from './piRpcProtocol';
import { PiRpcUiRequests } from './piRpcUiRequests';

const request = (overrides: Partial<PiExtensionUiRequest> = {}): PiExtensionUiRequest => ({
  id: 'ui-1',
  method: 'input',
  title: 'Input',
  type: 'extension_ui_request',
  ...overrides,
});
const cancel = { cancelled: true, id: 'ui-1', type: 'extension_ui_response' };
afterEach(() => vi.useRealTimers());

describe('PiRpcUiRequests', () => {
  it.each(['missing', 'wrong-id', 'throws'] as const)(
    'cancels rather than approving a %s handler',
    async (mode) => {
      const send = vi.fn();
      const ui = new PiRpcUiRequests({
        send,
        onRequest:
          mode === 'missing'
            ? undefined
            : () => {
                if (mode === 'throws') throw new Error('unavailable');
                return { id: 'another-request', type: 'extension_ui_response', confirmed: true };
              },
      });
      ui.dispatch(request());
      await vi.waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith(cancel));
      expect(ui.isWaiting).toBe(false);
    },
  );

  it.each(['timeout', 'close', 'duplicate'] as const)(
    'aborts host waits once on %s and discards late answers',
    async (path) => {
      vi.useFakeTimers();
      const send = vi.fn();
      let signal!: AbortSignal;
      let answer!: (response: PiExtensionUiResponse) => void;
      const ui = new PiRpcUiRequests({
        send,
        onRequest: (_request, value) => {
          signal = value;
          return new Promise((resolve) => (answer = resolve));
        },
      });
      ui.dispatch(request({ timeout: 100 }));
      await vi.advanceTimersByTimeAsync(0);
      if (path === 'close') ui.cancelAll();
      else if (path === 'duplicate') ui.dispatch(request());
      else await vi.advanceTimersByTimeAsync(100);
      expect(signal.aborted).toBe(true);
      expect(send).toHaveBeenCalledExactlyOnceWith(cancel);
      answer({ id: 'ui-1', type: 'extension_ui_response', value: 'late' });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(ui.isWaiting).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('surfaces notifications without sending a dialog response', async () => {
    const send = vi.fn();
    const onRequest = vi.fn();
    const ui = new PiRpcUiRequests({ send, onRequest });
    ui.dispatch(request({ method: 'notify' }));
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledOnce());
    expect(ui.isWaiting).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
