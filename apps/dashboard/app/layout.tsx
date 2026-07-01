import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Call Console - 企业智能外呼平台',
  description: '面向企业员工的 AI 外呼机器人管理控制台，基于 FreeSWITCH + NestJS + Next.js 构建',
};

const NAV_ITEMS_PRIMARY = [
  { href: '/', label: '概览', icon: 'home' },
  { href: '/tasks', label: '外呼任务', icon: 'phone' },
  { href: '/calls', label: '通话历史', icon: 'history' },
  { href: '/task-flows', label: '外呼流程', icon: 'flow' },
];

const NAV_ITEMS_SECONDARY = [
  { href: '/scenarios', label: '场景配置', icon: 'scenario' },
  { href: '/knowledge', label: '知识库', icon: 'knowledge' },
  { href: '/voice-demo', label: '语音演示', icon: 'mic' },
];

function NavIcon({ name }: { name: string }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'nav-icon',
  };
  switch (name) {
    case 'home':
      return (
        <svg {...props}>
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...props}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case 'history':
      return (
        <svg {...props}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
      );
    case 'flow':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="15" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
          <path d="M6 9v3a3 3 0 0 0 3 3" />
          <path d="M15 12h-3a3 3 0 0 0-3 3" />
        </svg>
      );
    case 'scenario':
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      );
    case 'knowledge':
      return (
        <svg {...props}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...props}>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...props}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    case 'help':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <circle cx="12" cy="17" r="0.5" fill="currentColor" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    default:
      return null;
  }
}

function getBreadcrumb(pathname: string) {
  if (pathname === '/') return { group: '工作台', current: '概览' };
  if (pathname.startsWith('/tasks')) return { group: '工作台', current: '外呼任务' };
  if (pathname.startsWith('/calls')) return { group: '工作台', current: '通话历史' };
  if (pathname.startsWith('/task-flows')) return { group: '工作台', current: '外呼流程' };
  if (pathname.startsWith('/scenarios')) return { group: '配置', current: '场景配置' };
  if (pathname.startsWith('/knowledge')) return { group: '配置', current: '知识库' };
  if (pathname.startsWith('/voice-demo')) return { group: '工具', current: '语音演示' };
  return { group: '工作台', current: '概览' };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="sidebar-header">
              <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
                <div className="brand-logo">AI</div>
                <div className="brand-text">
                  <span className="brand-name">Call Console</span>
                  <span className="brand-sub">智能外呼平台</span>
                </div>
              </Link>
            </div>

            <nav className="sidebar-nav">
              <div className="nav-group">
                <div className="nav-group-label">工作台</div>
                {NAV_ITEMS_PRIMARY.map((item) => (
                  <Link key={item.href} href={item.href} className="nav-item">
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>

              <div className="nav-group">
                <div className="nav-group-label">配置</div>
                {NAV_ITEMS_SECONDARY.map((item) => (
                  <Link key={item.href} href={item.href} className="nav-item">
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </nav>

            <div className="sidebar-footer">
              <div className="user-card">
                <div className="user-avatar">HR</div>
                <div className="user-info">
                  <div className="user-name">企业员工</div>
                  <div className="user-role">管理员</div>
                </div>
              </div>
            </div>
          </aside>

          <main className="main">
            <header className="topbar">
              <div className="topbar-left">
                <span className="breadcrumb">
                  <span>{getBreadcrumb('/').group}</span>
                  <span>/</span>
                  <span className="breadcrumb-current">{getBreadcrumb('/').current}</span>
                </span>
              </div>
              <div className="topbar-right">
                <button className="topbar-action" aria-label="搜索">
                  <NavIcon name="search" />
                </button>
                <button className="topbar-action" aria-label="通知">
                  <NavIcon name="bell" />
                </button>
                <button className="topbar-action" aria-label="帮助">
                  <NavIcon name="help" />
                </button>
              </div>
            </header>
            <div className="content">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}