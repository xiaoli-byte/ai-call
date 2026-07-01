'use client';

import type { ReactNode, CSSProperties, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, LabelHTMLAttributes } from 'react';
import { forwardRef } from 'react';

// ============================================================
// Button
// ============================================================

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'xs' | 'icon';
}

const buttonVariants = {
  default: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-900/30',
  destructive: 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-900/30',
  outline: 'border border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white',
  ghost: 'text-slate-400 hover:bg-slate-800 hover:text-white',
  secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700',
};

const buttonSizes = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-8 px-3 text-xs',
  xs: 'h-6 px-2 text-xs',
  icon: 'h-8 w-8 p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
          'disabled:pointer-events-none disabled:opacity-50',
          'cursor-pointer',
          buttonVariants[variant],
          buttonSizes[size],
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

// ============================================================
// Input
// ============================================================

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={[
          'flex h-9 w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200',
          'placeholder:text-slate-500',
          'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors duration-150',
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

// ============================================================
// Textarea
// ============================================================

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={[
          'flex min-h-[60px] w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200',
          'placeholder:text-slate-500',
          'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'resize-y transition-colors duration-150',
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

// ============================================================
// Select
// ============================================================

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={[
          'flex h-9 w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200',
          'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-colors duration-150 cursor-pointer',
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);
Select.displayName = 'Select';

// ============================================================
// Label
// ============================================================

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={[
          'text-xs font-medium text-slate-400 leading-none cursor-pointer',
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);
Label.displayName = 'Label';

// ============================================================
// Switch
// ============================================================

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({ id, checked, onCheckedChange, disabled, className = '' }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={[
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-blue-600' : 'bg-slate-700',
        className,
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0',
          'transform transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// ============================================================
// Badge
// ============================================================

export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'outline' | 'secondary';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const badgeVariants = {
  default: 'bg-slate-800 text-slate-300 border-slate-700',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  destructive: 'bg-red-500/15 text-red-400 border-red-500/30',
  outline: 'border border-slate-700 text-slate-400 bg-transparent',
  secondary: 'bg-slate-800/80 text-slate-300 border-slate-700/80',
};

export function Badge({ variant = 'default', className = '', style, children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        badgeVariants[variant],
        className,
      ].join(' ')}
      style={style}
    >
      {children}
    </span>
  );
}

// ============================================================
// Card
// ============================================================

export interface CardProps {
  className?: string;
  children: ReactNode;
}

export function Card({ className = '', children }: CardProps) {
  return (
    <div
      className={[
        'rounded-lg border border-slate-800 bg-slate-900/80 backdrop-blur-sm',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

// ============================================================
// Separator
// ============================================================

export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function Separator({ orientation = 'horizontal', className = '' }: SeparatorProps) {
  return (
    <div
      className={[
        'shrink-0 bg-slate-800',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      ].join(' ')}
    />
  );
}

// ============================================================
// Form Field
// ============================================================

export interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, error, hint, required, children, className = '' }: FormFieldProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1 mb-1.5">
        <Label>{label}</Label>
        {required && <span className="text-red-500 text-xs">*</span>}
      </div>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}