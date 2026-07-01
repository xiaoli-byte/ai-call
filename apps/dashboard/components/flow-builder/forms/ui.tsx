'use client';

import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import styles from '../flow-builder.module.scss';

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
    <div className={styles.flowField}>
      <Label className={styles.flowFieldLabel}>{label}</Label>
      {children}
      {hint && !error && <div className={styles.flowFieldHint}>{hint}</div>}
      {error && <div className={styles.flowFieldError}>{error}</div>}
    </div>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return <Input {...props} className={`${styles.flowInput} ${props.className ?? ''}`} />;
}

export function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return <Textarea {...props} className={`${styles.flowTextarea} ${props.className ?? ''}`} />;
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return <select {...props} className={`${styles.flowSelect} ${props.className ?? ''}`} />;
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
    <label className={styles.flowCheckbox}>
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
  return <div className={styles.flowSectionTitle}>{children}</div>;
}

export function Divider() {
  return <Separator className={styles.flowSectionDivider} />;
}
