import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormInput, FormSelect, FormTextarea } from '../components/ui/form-field';

const schema = z.object({
  name: z.string().min(1, '名称不能为空'),
  note: z.string().optional(),
  status: z.enum(['active', 'inactive']),
});

type FormValues = z.infer<typeof schema>;

function Harness({ onSubmit }: { onSubmit: (values: FormValues) => void }) {
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', note: '', status: 'active' },
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FormInput control={control} name="name" label="名称" placeholder="请输入名称" />
      <FormTextarea control={control} name="note" label="备注" hint="选填" />
      <FormSelect control={control} name="status" label="状态">
        <option value="active">启用</option>
        <option value="inactive">停用</option>
      </FormSelect>
      <button type="submit">提交</button>
    </form>
  );
}

describe('RHF 表单字段封装', () => {
  it('渲染走全局 form 类，hint 正常展示', () => {
    const { container } = render(<Harness onSubmit={() => {}} />);
    expect(container.querySelector('input.form-input')).toBeTruthy();
    expect(container.querySelector('textarea.form-textarea')).toBeTruthy();
    expect(container.querySelector('select.form-select')).toBeTruthy();
    expect(screen.getByText('选填')).toBeTruthy();
  });

  it('zod 校验失败时以 role=alert 展示中文错误并阻止提交', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('名称不能为空'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('名称').getAttribute('aria-invalid')).toBe('true');
  });

  it('填写合法值后提交拿到类型化数据', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '电商场景' } });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'inactive' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: '电商场景', status: 'inactive' });
  });
});
