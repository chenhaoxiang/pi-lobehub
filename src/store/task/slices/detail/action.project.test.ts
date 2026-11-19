import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskService } from '@/services/task';

import { useTaskStore } from '../../store';

vi.mock('@/services/task', () => ({
  taskService: {
    find: vi.fn(),
    getDetail: vi.fn(),
    update: vi.fn(),
  },
}));

const detail = (projectId: string | null) =>
  ({ id: 'T-1', identifier: 'T-1', instruction: 'x', projectId, status: 'backlog' }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    activeTaskId: 'T-1',
    taskDetailMap: { 'T-1': detail('p1') },
    taskRefIndex: { 'T-1': 'T-1' },
    taskSaveStatusMap: {},
  });
});

describe('updateTask projectId', () => {
  it('projects a selected project and clear optimistically into detail state', async () => {
    vi.mocked(taskService.update).mockResolvedValue({ success: true } as any);
    const refreshTaskList = vi.fn().mockResolvedValue(undefined);
    useTaskStore.setState({ refreshTaskList } as any);

    await useTaskStore.getState().updateTask('T-1', { projectId: 'p2' });
    expect(useTaskStore.getState().taskDetailMap['T-1'].projectId).toBe('p2');

    await useTaskStore.getState().updateTask('T-1', { projectId: null });
    expect(useTaskStore.getState().taskDetailMap['T-1'].projectId).toBeNull();
    expect(taskService.update).toHaveBeenNthCalledWith(2, 'T-1', { projectId: null });
    // `refreshTaskList` revalidates every loaded list and project-scoped board;
    // it is the existing boundary that refills the target board and removes the old row.
    expect(refreshTaskList).toHaveBeenCalledTimes(2);
  });

  it('rolls the project projection back after a refused save', async () => {
    vi.mocked(taskService.getDetail).mockResolvedValue({ data: detail('p1') } as any);
    vi.mocked(taskService.update).mockRejectedValue(new Error('Project not found'));

    await expect(
      useTaskStore.getState().updateTask('T-1', { projectId: 'missing' }),
    ).rejects.toThrow('Project not found');
    expect(useTaskStore.getState().taskDetailMap['T-1'].projectId).toBe('p1');
  });
});
