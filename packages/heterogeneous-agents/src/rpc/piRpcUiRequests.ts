import type { PiExtensionUiRequest, PiExtensionUiResponse } from './piRpcProtocol';

const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);
const DEFAULT_UI_TIMEOUT_MS = 10 * 60 * 1000;

export type PiRpcUiHandler = (
  request: PiExtensionUiRequest,
  signal: AbortSignal,
) => Promise<PiExtensionUiResponse | undefined> | PiExtensionUiResponse | undefined;

interface PendingDialog {
  cancel: () => void;
}

/** UI waits must never block the stdio reader (including abort ACKs and EOF). */
export class PiRpcUiRequests {
  private readonly pending = new Map<string, PendingDialog>();

  constructor(
    private readonly options: {
      onRequest?: PiRpcUiHandler;
      onWaitingChanged?: (waiting: boolean) => void;
      send: (response: PiExtensionUiResponse) => void;
    },
  ) {}

  get isWaiting(): boolean {
    return this.pending.size > 0;
  }

  dispatch(request: PiExtensionUiRequest): void {
    if (!DIALOG_METHODS.has(request.method)) {
      void Promise.resolve()
        .then(() => this.options.onRequest?.(request, new AbortController().signal))
        .catch(() => {});
      return;
    }
    if (typeof request.id !== 'string' || !request.id) return;
    const previous = this.pending.get(request.id);
    if (previous) {
      // Reused native ids are ambiguous. Cancel, never answer a replacement.
      previous.cancel();
      return;
    }
    const controller = new AbortController();
    const entry: PendingDialog = { cancel: () => finish(undefined) };
    const finish = (response: PiExtensionUiResponse | undefined) => {
      if (this.pending.get(request.id) !== entry) return;
      this.pending.delete(request.id);
      if (!this.pending.size) this.options.onWaitingChanged?.(false);
      clearTimeout(timer);
      controller.abort();
      // The host cannot redirect an answer to a different native question.
      const valid = response?.id === request.id && response.type === 'extension_ui_response';
      try {
        this.options.send(
          valid
            ? response
            : {
                cancelled: true,
                id: request.id,
                type: 'extension_ui_response',
              },
        );
      } catch {
        // A dead transport is handled by its own process-error path.
      }
    };
    this.pending.set(request.id, entry);
    if (this.pending.size === 1) this.options.onWaitingChanged?.(true);
    const timeout =
      typeof request.timeout === 'number' && Number.isFinite(request.timeout)
        ? Math.max(0, Math.min(request.timeout, DEFAULT_UI_TIMEOUT_MS))
        : DEFAULT_UI_TIMEOUT_MS;
    const timer = setTimeout(() => finish(undefined), timeout);
    timer.unref?.();
    void Promise.resolve()
      .then(() =>
        controller.signal.aborted
          ? undefined
          : this.options.onRequest?.(request, controller.signal),
      )
      .then(finish, () => finish(undefined));
  }

  /** Abort/settlement/disconnect releases every host wait before closing stdio. */
  cancelAll(): void {
    for (const entry of this.pending.values()) entry.cancel();
  }
}
