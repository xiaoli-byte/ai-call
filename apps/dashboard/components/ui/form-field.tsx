'use client';

/**
 * 表单字段封装 —— 激活 react-hook-form + zod（依赖早已安装）。
 *
 * 设计约定（重要，勿破坏）：
 * - 透传 RHF 的标准约定（control + name + useController），不发明私有 DSL；
 *   校验统一走 zod schema + zodResolver，在 useForm({ resolver }) 处配置。
 * - 渲染复用全局既有样式（.form-label/.form-input/.form-select/.form-textarea），
 *   与手写表单视觉一致，存量表单可逐个迁移、混排无差异。
 * - 错误文案取自 fieldState.error.message（即 zod schema 里的中文 message），
 *   以 role="alert" 暴露给测试与读屏。
 */

import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** 字段外壳：label + 控件 + hint/error。不绑定 RHF，可独立用于自绘控件。 */
export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  return (
    <label className="form-field-shell" style={{ display: 'block' }}>
      <span className="form-label">{label}</span>
      {children}
      {error ? (
        <span className="scenario-field-hint" role="alert" style={{ color: 'var(--danger, #dc2626)' }}>
          {error}
        </span>
      ) : hint ? (
        <span className="scenario-field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

interface BoundFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  hint?: string;
}

export function FormInput<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  ...rest
}: BoundFieldProps<T> & Omit<InputHTMLAttributes<HTMLInputElement>, 'name'>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <FieldShell label={label} hint={hint} error={fieldState.error?.message}>
      <input
        className="form-input"
        aria-label={label}
        aria-invalid={fieldState.invalid || undefined}
        {...rest}
        {...field}
        value={field.value ?? ''}
      />
    </FieldShell>
  );
}

export function FormTextarea<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  ...rest
}: BoundFieldProps<T> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name'>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <FieldShell label={label} hint={hint} error={fieldState.error?.message}>
      <textarea
        className="form-textarea"
        aria-label={label}
        aria-invalid={fieldState.invalid || undefined}
        {...rest}
        {...field}
        value={field.value ?? ''}
      />
    </FieldShell>
  );
}

export function FormSelect<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  children,
  ...rest
}: BoundFieldProps<T> &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name'> & { children: ReactNode }) {
  const { field, fieldState } = useController({ control, name });
  return (
    <FieldShell label={label} hint={hint} error={fieldState.error?.message}>
      <select
        className="form-select"
        aria-label={label}
        aria-invalid={fieldState.invalid || undefined}
        {...rest}
        {...field}
        value={field.value ?? ''}
      >
        {children}
      </select>
    </FieldShell>
  );
}
