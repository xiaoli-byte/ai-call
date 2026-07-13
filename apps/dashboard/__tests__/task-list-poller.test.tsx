import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { TaskListPoller } from '../app/tasks/task-list-poller';

describe('TaskListPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refresh.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes the task list every three seconds and stops after unmount', () => {
    const view = render(<TaskListPoller />);

    act(() => vi.advanceTimersByTime(2_999));
    expect(mocks.refresh).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    view.unmount();
    act(() => vi.advanceTimersByTime(3_000));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
