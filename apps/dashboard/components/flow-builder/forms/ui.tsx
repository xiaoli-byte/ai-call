'use client';

import type { ReactNode } from 'react';

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flow-field">
      <label className="flow-field-label">{label}</label>
      {children}
      {hint && !error && <div className="flow-field-hint">{hint}</div>}
      {error && <div className="flow-field-error">{error}</div>}
    </div>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return <input {...props} className={`flow-input ${props.className ?? ''}`} />;
}

export function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea {...props} className={`flow-textarea ${props.className ?? ''}`} />
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <select {...props} className={`flow-select ${props.className ?? ''}`} />
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flow-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="flow-section-title">{children}</div>;
}

export function Divider() {
  return <div className="flow-section-divider" />;
}