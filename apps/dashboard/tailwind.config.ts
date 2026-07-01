import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * AI Call Dashboard - Tailwind 配置
 *
 * 设计系统（基于 ui-ux-pro-max 推荐）：
 * - Pattern: Enterprise Gateway
 * - Style: Minimal Swiss + Glassmorphism 微元素
 * - Primary: Trust Blue (#2563EB)
 * - Background: #F8FAFC (浅色)
 * - Typography: Inter
 *
 * 架构：preflight 接管 reset，shadcn/ui 兼容 HSL 变量 + 项目既有 hex 变量并存，
 * token 单一来源（globals.css :root CSS 变量），Tailwind theme.extend 引用变量。
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  corePlugins: {
    preflight: true,
  },
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // === shadcn/ui 兼容变量（HSL 格式，供 shadcn 组件使用）===
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // === 项目既有 token（引用 CSS 变量，单一来源）===
        success: {
          50: 'var(--success-bg)',
          500: 'var(--success)',
          600: '#059669',
          700: '#047857',
        },
        warning: {
          50: 'var(--warning-bg)',
          500: 'var(--warning)',
          600: '#D97706',
          700: '#B45309',
        },
        danger: {
          50: 'var(--danger-bg)',
          500: 'var(--danger)',
          600: '#DC2626',
          700: '#B91C1C',
        },
        info: {
          50: 'var(--info-bg)',
          500: 'var(--info)',
          600: 'var(--primary-600)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif',
        ],
        mono: [
          'SF Mono',
          'Monaco',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': '16px',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        sm: '0 1px 2px 0 rgba(15, 23, 42, 0.05), 0 1px 3px 0 rgba(15, 23, 42, 0.05)',
        DEFAULT: '0 1px 3px 0 rgba(15, 23, 42, 0.06), 0 1px 2px -1px rgba(15, 23, 42, 0.06)',
        md: '0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.06)',
        lg: '0 10px 15px -3px rgba(15, 23, 42, 0.06), 0 4px 6px -4px rgba(15, 23, 42, 0.06)',
        xl: '0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.06)',
        primary: '0 4px 12px -2px rgba(37, 99, 235, 0.25)',
        'primary-sm': '0 2px 6px -1px rgba(37, 99, 235, 0.2)',
        focus: '0 0 0 3px rgba(37, 99, 235, 0.15)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-in': 'slide-in 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        pulse: 'pulse 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
