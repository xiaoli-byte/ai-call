import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GlobalConfigPage from '../app/global-config/page';

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  update: vi.fn(),
  config: {
    id: 'global-config',
    globalVariables: [
      {
          key: 'customer_name',
          label: '客户姓名',
          description: '用于开场白称呼客户',
        },
        {
          key: 'amount_due',
          label: '应还金额',
          description: '催收场景中的欠款金额，单位：元',
          defaultValue: '0',
        },
    ],
    apiPlugins: [],
    outboundRules: {
      callWindow: {
        startTime: '09:00',
        endTime: '18:00',
        weekdaysOnly: true,
        nonHolidayOnly: false,
      },
      dailyCallLimitPerCallee: 3,
      blockedNumbers: [],
      globalWhitelist: [],
    },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mocks.back }),
}));

vi.mock('@/lib/toast', () => ({
  appToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/hooks/use-global-config', () => ({
  useGlobalConfig: () => ({
    data: mocks.config,
    error: undefined,
    isLoading: false,
  }),
  useGlobalConfigMutations: () => ({
    update: mocks.update,
  }),
}));

describe('global config variables table', () => {
  it('renders variables read-only by default and switches one row into edit mode', async () => {
    render(<GlobalConfigPage />);

    expect(screen.getByRole('columnheader', { name: '显示名称' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '描述' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: '类型' })).toBeNull();
    expect(await screen.findByText('{{customer_name}}')).toBeTruthy();
    expect(screen.getByText('客户姓名')).toBeTruthy();
    expect(screen.getByText('用于开场白称呼客户')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByDisplayValue('customer_name')).toBeNull();

    const customerRow = screen.getByText('{{customer_name}}').closest('tr');
    expect(customerRow).toBeTruthy();

    fireEvent.click(within(customerRow as HTMLTableRowElement).getByRole('button', { name: '编辑' }));

    expect(screen.getByDisplayValue('customer_name')).toBeTruthy();
    expect(screen.getByDisplayValue('客户姓名')).toBeTruthy();
    expect(screen.getByDisplayValue('用于开场白称呼客户')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(within(customerRow as HTMLTableRowElement).getByRole('button', { name: '保存' })).toBeTruthy();
    expect(within(customerRow as HTMLTableRowElement).getByRole('button', { name: '取消' })).toBeTruthy();
  });
});
