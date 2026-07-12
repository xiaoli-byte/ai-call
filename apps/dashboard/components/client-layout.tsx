"use client";

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { AuthProvider } from '@/components/auth-provider';
import { useAuthStore } from '@/lib/auth-store';
import { apiClient } from '@/lib/api/client';
import { AUTH_KEY } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

import styles from './client-layout.module.scss';

const NAV_ITEMS_PRIMARY = [
  { href: '/', label: '概览', icon: 'home' },
  { href: '/tasks', label: '外呼任务', icon: 'phone' },
  { href: '/task-flows', label: '外呼流程', icon: 'flow' },
  // { href: '/analytics', label: '效果分析', icon: 'chart' },
  // { href: '/quality', label: '通话质检', icon: 'shield' },
  // { href: '/handoffs', label: '人工承接', icon: 'handoff' },
  // { href: '/templates', label: '模板中心', icon: 'flow' },
  // { href: '/datasets', label: '数据闭环', icon: 'knowledge' },
  // { href: '/observability', label: '观测与成本', icon: 'chart' },
];

const NAV_ITEMS_SECONDARY = [
  { href: '/scenarios', label: '场景配置', icon: 'scenario' },
  // { href: '/compliance', label: '合规中心', icon: 'check' },
  // { href: '/integrations', label: '集成中心', icon: 'integration' },
  { href: '/voice-clones', label: '音色克隆', icon: 'mic' },
  { href: '/global-config', label: '全局配置', icon: 'key' },
  { href: '/knowledge', label: '知识库', icon: 'knowledge' },
  { href: '/voice-demo', label: '语音演示', icon: 'mic' },
  // { href: '/demo-guide', label: '演示交付', icon: 'help' },
];

const NAV_ITEMS_SYSTEM = [
  { href: '/organizations', label: '组织管理', icon: 'users' },
  { href: '/system/users', label: '用户管理', icon: 'users' },
  { href: '/system/roles', label: '角色权限', icon: 'shield' },
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
    className: styles.navIcon,
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
    case 'chart':
      return (
        <svg {...props}>
          <path d="M3 3v18h18" />
          <rect x="7" y="12" width="3" height="5" rx="1" />
          <rect x="12" y="8" width="3" height="9" rx="1" />
          <rect x="17" y="5" width="3" height="12" rx="1" />
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
    case 'handoff':
      return (
        <svg {...props}>
          <path d="M16 11a4 4 0 1 0-8 0" />
          <path d="M4 21a8 8 0 0 1 16 0" />
          <path d="M17 8h3a2 2 0 0 1 2 2v2" />
          <path d="M22 12l-3-3" />
          <path d="M22 12l-3 3" />
        </svg>
      );
    case 'integration':
      return (
        <svg {...props}>
          <path d="M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path d="M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v-1" />
          <path d="M15 5h3a3 3 0 0 1 3 3v2" />
          <path d="M21 10l-3-3" />
          <path d="M21 10l-3 3" />
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
    case 'logout':
      return (
        <svg {...props}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      );
    case 'users':
      return (
        <svg {...props}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...props}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...props}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'key':
      return (
        <svg {...props}>
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
      );
    case 'x':
      return (
        <svg {...props}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'chevron-left':
      return (
        <svg {...props}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...props}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    default:
      return null;
  }
}

function getBreadcrumb(pathname: string) {
  if (pathname === '/') return { group: '工作台', current: '概览' };
  if (pathname.startsWith('/tasks')) return { group: '工作台', current: '外呼任务' };
  if (pathname.startsWith('/task-flows')) return { group: '工作台', current: '外呼流程' };
  if (pathname.startsWith('/analytics')) return { group: '工作台', current: '效果分析' };
  if (pathname.startsWith('/quality')) return { group: '工作台', current: '通话质检' };
  if (pathname.startsWith('/handoffs')) return { group: '工作台', current: '人工承接' };
  if (pathname.startsWith('/templates')) return { group: '工作台', current: '模板中心' };
  if (pathname.startsWith('/datasets')) return { group: '工作台', current: '数据闭环' };
  if (pathname.startsWith('/insights')) return { group: '工作台', current: '数据洞察' };
  if (pathname.startsWith('/observability')) return { group: '工作台', current: '观测与成本' };
  if (pathname.startsWith('/costs')) return { group: '工作台', current: '成本中心' };
  if (pathname.startsWith('/scenarios')) return { group: '配置', current: '场景测试' };
  if (pathname.startsWith('/compliance')) return { group: '配置', current: '合规中心' };
  if (pathname.startsWith('/integrations')) return { group: '配置', current: '集成中心' };
  if (pathname.startsWith('/voice-clones')) return { group: '配置', current: '音色克隆' };
  if (pathname.startsWith('/global-config')) return { group: '配置', current: '全局配置' };
  if (pathname.startsWith('/knowledge')) return { group: '配置', current: '知识库' };
  if (pathname.startsWith('/voice-demo')) return { group: '工具', current: '语音演示' };
  if (pathname.startsWith('/demo-guide')) return { group: '工具', current: '演示交付' };
  if (pathname.startsWith('/organizations')) return { group: '系统管理', current: '组织管理' };
  if (pathname.startsWith('/system/users')) return { group: '系统管理', current: '用户管理' };
  if (pathname.startsWith('/system/roles')) return { group: '系统管理', current: '角色权限' };
  return { group: '工作台', current: '概览' };
}

function SidebarFooter() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const { mutate } = useSWRConfig();

  const handleLogout = async () => {
    try {
      await apiClient.logout();
    } finally {
      // 清空 SWR user 缓存，避免登出后仍显示旧用户
      await mutate(AUTH_KEY, null, { revalidate: false });
      logout();
      router.push('/login');
      router.refresh();
    }
  };

  const initials = user?.name
    ? user.name.slice(0, 2).toUpperCase()
    : user?.email.slice(0, 2).toUpperCase() ?? '??';
  const roleLabel = user?.roles?.[0] ?? '未登录';

  return (
    <div className={styles.userCard}>
      <div className={styles.userAvatar}>{initials}</div>
      <div className={styles.userInfo}>
        <div className={styles.userName}>{user?.name ?? '企业员工'}</div>
        <div className={styles.userRole}>{roleLabel}</div>
      </div>
      <button
        onClick={handleLogout}
        className={styles.topbarAction}
        aria-label="退出登录"
        title="退出登录"
      >
        <NavIcon name="logout" />
      </button>
    </div>
  );
}

export function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const isPublicPage = pathname === '/' || pathname === '/home' || pathname === '/login';

  const [collapsed, setCollapsed] = useState(false);
  const toggleSidebar = () => setCollapsed((prev) => !prev);

  const hasSystemPermission =
    user?.permissions?.some(
      (p) =>
        p === 'system:user:read' ||
        p === 'system:role:read',
    ) ?? false;

  if (isPublicPage) {
    return (
      <AuthProvider>
        <main className="min-h-screen">{children}</main>
      </AuthProvider>
    );
  }

  const breadcrumb = getBreadcrumb(pathname);

  return (
    <AuthProvider>
      <div data-dashboard-shell className={cn(styles.appShell, collapsed && styles.sidebarCollapsed)}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <Link href="/" className={styles.brand}>
              <div className={styles.brandLogo}>AI</div>
              <div className={styles.brandText}>
                <span className={styles.brandName}>外呼中心</span>
                <span className={styles.brandSub}>AI 智能外呼系统</span>
              </div>
            </Link>
            <button
              type="button"
              className={styles.sidebarToggle}
              onClick={toggleSidebar}
              title={collapsed ? '展开菜单' : '收起菜单'}
              aria-label={collapsed ? '展开菜单' : '收起菜单'}
            >
              <NavIcon name={collapsed ? 'chevron-right' : 'chevron-left'} />
            </button>
          </div>

          <nav className={styles.sidebarNav}>
            <div className={styles.navGroup}>
              <div className={styles.navGroupLabel}>工作台</div>
              {NAV_ITEMS_PRIMARY.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    styles.navItem,
                    (pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))) &&
                      styles.navItemActive,
                  )}
                  title={item.label}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>

            <div className={styles.navGroup}>
              <div className={styles.navGroupLabel}>配置</div>
              {NAV_ITEMS_SECONDARY.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(styles.navItem, pathname.startsWith(item.href) && styles.navItemActive)}
                  title={item.label}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>

            {hasSystemPermission && (
              <div className={styles.navGroup}>
                <div className={styles.navGroupLabel}>系统管理</div>
                {NAV_ITEMS_SYSTEM.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(styles.navItem, pathname.startsWith(item.href) && styles.navItemActive)}
                    title={item.label}
                  >
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </nav>

          <div className={styles.sidebarFooter}>
            <SidebarFooter />
          </div>
        </aside>

        <main className={styles.main}>
          <header className={styles.topbar}>
            <div className={styles.topbarLeft}>
              <span className={styles.breadcrumb}>
                <span>{breadcrumb.group}</span>
                <span>/</span>
                <span className={styles.breadcrumbCurrent}>{breadcrumb.current}</span>
              </span>
            </div>
            <div className={styles.topbarRight}>
              <button className={styles.topbarAction} aria-label="搜索">
                <NavIcon name="search" />
              </button>
              <button className={styles.topbarAction} aria-label="通知">
                <NavIcon name="bell" />
              </button>
              <button className={styles.topbarAction} aria-label="帮助">
                <NavIcon name="help" />
              </button>
            </div>
          </header>
          <div className={styles.content}>{children}</div>
        </main>
      </div>
    </AuthProvider>
  );
}
