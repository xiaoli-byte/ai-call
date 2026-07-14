import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { apiServer } from '@/lib/api/server';
import { ApiError } from '@/lib/api/types';
import { SWRProvider } from '@/hooks/swr-provider';
import { authKeyString } from '@/hooks/auth-key';
import { ClientLayout } from '@/components/client-layout';
import type { UserProfile } from '@ai-call/shared';
import './globals.css';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/legacy-ui.css';
import '@/styles/vendors/react-flow.css';

export const metadata: Metadata = {
  title: 'AI Call Console - 企业智能外呼平台',
  description:
    '面向企业员工的 AI 外呼机器人管理控制台，基于 FreeSWITCH + NestJS + Next.js 构建',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server 端预取 user：401/未登录时 user=null（middleware 会处理重定向），
  // 非 401 错误（如后端不可达）不阻塞渲染，由 error.tsx boundary 兜底。
  let user: UserProfile | null = null;
  try {
    user = await apiServer.auth.me();
  } catch (e) {
    if (!(e instanceof ApiError && e.isUnauthorized)) {
      // 后端不可达等非预期错误：记录但不抛，避免整页白屏
    }
  }

  // user 为 null（未登录）时不放入 fallback，useAuth 会触发请求并由 api 层处理 401
  const fallback: Record<string, unknown> = {};
  if (user) {
    fallback[authKeyString()] = user;
  }

  return (
    <html lang="zh-CN">
      <body>
        <SWRProvider fallback={fallback}>
          <ClientLayout>{children}</ClientLayout>
        </SWRProvider>
        {/* 全局 toast 挂载点：app/lib/toast.ts 的 appToast 依赖它才能实际渲染，
            此前仓库内一直未挂载，appToast 调用形同虚设。 */}
        <Toaster />
      </body>
    </html>
  );
}
