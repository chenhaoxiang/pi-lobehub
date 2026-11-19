import type { AgentRuntimeHost } from '../transport';
import type { AgentEvent, AgentInstruction, InstructionExecutor } from '../types';

/**
 * `finish` executor — terminates the operation.
 *
 * First executor migrated from the server into this package as part of the
 * agent-runtime IO transport port abstraction: it depends only on
 * the `StreamSink` + `OperationStore` transports and the operation context, so
 * the server just provides those adapters. Behavior mirrors the previous
 * server-local implementation exactly.
 */
export const finish =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
    const { operation, transports } = host;

    // Clear the topic's running-operation mark so a reconnect doesn't
    // re-trigger after completion. Best-effort — the adapter swallows failures.
    await transports.operationStore?.clearRunningMark();

    const isFailure = reason === 'tool_name_unresolved';
    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = isFailure ? 'error' : 'done';
    if (isFailure && !newState.error) {
      newState.error = {
        errorType: reason,
        message: reasonDetail ?? 'The model repeatedly requested tools that do not exist.',
        type: reason,
      };
    }

    // State snapshots are opt-in; internal terminal events always retain the
    // state. An unresolved tool name is a runtime failure, not a successful
    // delivery: persist the error status before any server lifecycle consumer
    // observes the step completion event.
    await transports.stream.publishEvent({
      data: {
        ...(state.host?.includeFinalState === true && { finalState: newState }),
        phase: 'execution_complete',
        reason,
        reasonDetail,
      },
      stepIndex: operation.stepIndex,
      type: 'step_complete',
    });

    const events: AgentEvent[] = [{ finalState: newState, reason, reasonDetail, type: 'done' }];

    return { events, newState };
  };
