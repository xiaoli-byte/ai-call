# Public Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated root dashboard overview with an unauthenticated public AI Call homepage that showcases existing intelligent outbound calling capabilities and an ecommerce after-sales script demo.

**Architecture:** Keep the implementation inside the existing Next.js dashboard app. The root page becomes a static public landing page, while middleware and client layout bypass the dashboard shell for `/` and keep all management routes protected. Login defaults to the authenticated console entry at `/campaigns`.

**Tech Stack:** Next.js 14 App Router, React 18, SCSS modules, existing dashboard auth middleware, Playwright/browser visual verification through the local dev server.

---

## File Structure

- Modify `apps/dashboard/app/page.tsx`: Replace the current authenticated overview content with a static public landing page.
- Modify `apps/dashboard/app/page.module.scss`: Replace the old KPI/architecture styles with homepage-specific public landing styles.
- Create `apps/dashboard/__tests__/homepage-public.test.tsx`: Lock the hero demo panel structure so it stays a compact voice stage with one rotating subtitle area rather than a multi-card chat transcript.
- Modify `apps/dashboard/components/client-layout.tsx`: Treat `/` as a public shell-free route alongside `/login`.
- Modify `apps/dashboard/middleware.ts`: Allow unauthenticated access to `/`, redirect logged-in login visits to `/campaigns`, and keep dashboard routes protected.
- Modify `apps/dashboard/app/login/page.tsx`: Honor an explicit `redirect` query parameter and default successful login to `/campaigns`.

## Task 1: Public Route And Login Behavior

**Files:**
- Modify: `apps/dashboard/middleware.ts`
- Modify: `apps/dashboard/components/client-layout.tsx`
- Modify: `apps/dashboard/app/login/page.tsx`

- [ ] **Step 1: Inspect current route guards**

Run:

```powershell
Get-Content -Raw -Encoding UTF8 apps/dashboard/middleware.ts
Get-Content -Raw -Encoding UTF8 apps/dashboard/components/client-layout.tsx
Get-Content -Raw -Encoding UTF8 apps/dashboard/app/login/page.tsx
```

Expected: `/login` is the only public shell-free route, unauthenticated `/` redirects to `/login`, and successful login pushes `/`.

- [ ] **Step 2: Update middleware**

Change `middleware` to:

```ts
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicHome = pathname === '/';
  const isLoginPage = pathname === '/login';
  const accessToken = request.cookies.get('access_token')?.value;
  const hasValidToken = !!accessToken && !isTokenExpired(accessToken);

  if (isPublicHome) {
    return NextResponse.next();
  }

  if (isLoginPage) {
    if (hasValidToken) {
      return NextResponse.redirect(new URL('/campaigns', request.url));
    }
    return NextResponse.next();
  }

  if (!hasValidToken) {
    const url = new URL('/login', request.url);
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
```

- [ ] **Step 3: Update client layout shell bypass**

In `ClientLayout`, replace:

```ts
const isLoginPage = pathname === '/login';
```

with:

```ts
const isPublicPage = pathname === '/' || pathname === '/login';
```

Then replace:

```tsx
if (isLoginPage) {
  return (
    <AuthProvider>
      <main className="min-h-screen">{children}</main>
    </AuthProvider>
  );
}
```

with:

```tsx
if (isPublicPage) {
  return (
    <AuthProvider>
      <main className="min-h-screen">{children}</main>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Update login redirect handling**

In `apps/dashboard/app/login/page.tsx`, import `useSearchParams`:

```ts
import { useRouter, useSearchParams } from 'next/navigation';
```

Inside `LoginPage`, add:

```ts
const searchParams = useSearchParams();
const redirectTo = searchParams.get('redirect') || '/campaigns';
```

Replace:

```ts
router.push('/');
```

with:

```ts
router.push(redirectTo);
```

- [ ] **Step 5: Run dashboard typecheck**

Run from repo root:

```powershell
pnpm --filter @ai-call/dashboard test:typecheck
```

Expected: command exits with code 0.

## Task 2: Public Homepage Content

**Files:**
- Modify: `apps/dashboard/app/page.tsx`

- [ ] **Step 1: Replace imports**

Use:

```ts
import Link from 'next/link';
import {
  BarChart3,
  BookOpenCheck,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Gauge,
  GitBranch,
  Headphones,
  Keyboard,
  LogIn,
  Megaphone,
  Mic2,
  Phone,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

import styles from './page.module.scss';
```

- [ ] **Step 2: Add static content arrays**

Define:

```ts
const navItems = [
  { label: '智能外呼', href: '#hero' },
  { label: '电商话术试用', href: '#ecommerce-demo' },
  { label: '解决方案', href: '#solution' },
  { label: '技术架构', href: '#architecture' },
];

const capabilities = [
  { title: '批量任务调度', description: '按活动、名单和时间窗发起外呼。', icon: ClipboardList },
  { title: '话术流程编排', description: '节点化配置问候、分支、动作和结束策略。', icon: Workflow },
  { title: '实时语音交互', description: 'STT、LLM、TTS 串联完成自然对话。', icon: Mic2 },
  { title: '业务工具调用', description: '查询订单、退款、预约取件并回写业务系统。', icon: Boxes },
  { title: '知识库兜底', description: '通过 RAG 约束政策、金额和时效回复。', icon: BookOpenCheck },
  { title: '人工承接', description: '投诉、争议或情绪异常时自动转人工。', icon: Headphones },
  { title: '通话质检', description: '沉淀录音、转写、标签和问题归因。', icon: ShieldCheck },
  { title: '数据闭环', description: '统计接通率、完成率、转人工和意向结果。', icon: BarChart3 },
];

const flowSteps = [
  { title: '身份与订单确认', description: '核对客户称呼、订单号、购买商品和回访目的。' },
  { title: '识别售后意图', description: '区分未签收、物流异常、退款进度、换货诉求。' },
  { title: '调用业务工具', description: '查询订单状态，预约补发、取件或创建售后工单。' },
  { title: '完成闭环或转人工', description: '输出处理结果；投诉、争议、强烈不满时转人工。' },
];

const architectureItems = [
  { title: 'FreeSWITCH 语音接入', description: '承接 SIP、音频流和通话事件。', icon: PhoneCall },
  { title: 'Voice Agent 实时编排', description: '驱动 STT、LLM、TTS 和打断处理。', icon: Bot },
  { title: 'NestJS 业务接口', description: '提供任务、订单、工单和工具调用能力。', icon: GitBranch },
  { title: 'Next.js 控制台', description: '管理活动、话术、质检和数据看板。', icon: Gauge },
  { title: 'RAG 知识库', description: '约束政策、金额、时效等高风险回答。', icon: BrainCircuit },
  { title: 'Function Calling 闭环', description: '把对话意图转成可追踪的业务动作。', icon: CheckCircle2 },
];
```

- [ ] **Step 3: Replace `HomePage` JSX**

Render a public page with:

- Header nav and brand.
- Hero title and copy.
- Buttons linking `#ecommerce-demo` and `/campaigns`.
- Large voice demo panel with ecommerce transcript.
- Solution capability grid.
- Ecommerce trial section with steps and chat transcript.
- Technical credibility grid.
- Footer CTA with `/login` and `/campaigns`.

Use existing project concepts only; do not add new products or unsupported claims.

- [ ] **Step 4: Run dashboard typecheck**

Run:

```powershell
pnpm --filter @ai-call/dashboard test:typecheck
```

Expected: command exits with code 0.

## Task 3: Public Homepage Styling

**Files:**
- Create: `apps/dashboard/__tests__/homepage-public.test.tsx`
- Modify: `apps/dashboard/app/page.tsx`
- Modify: `apps/dashboard/app/page.module.scss`

- [ ] **Step 1: Add the failing hero voice-stage test**

Create `apps/dashboard/__tests__/homepage-public.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '../app/page';

describe('public homepage hero demo', () => {
  it('uses a compact rotating voice stage instead of rendering all call turns as chat cards', () => {
    render(<HomePage />);

    const stage = screen.getByLabelText('电商售后回访语音演示');

    expect(within(stage).getByText('电商售后回访 · 试用中')).toBeTruthy();
    expect(within(stage).getByLabelText('电商售后话术轮播')).toBeTruthy();
    expect(within(stage).getByText('正在确认订单与签收状态')).toBeTruthy();
    expect(within(stage).queryByText('包裹还没收到，短信说已经签收了。')).toBeNull();
  });
});
```

Run:

```powershell
apps/dashboard/node_modules/.bin/vitest.CMD run __tests__/homepage-public.test.tsx
```

Expected before implementation: the test fails because the hero still renders every call turn as separate transcript text and has no `电商售后话术轮播` subtitle area.

- [ ] **Step 2: Replace old overview styles**

Remove the old `.statCard`, `.architecture`, and KPI styles. Add scoped public homepage styles for:

- `.landingPage`
- `.publicNav`
- `.brand`
- `.hero`
- `.heroCopy`
- `.heroActions`
- `.demoPanel`
- `.voiceSphere`
- `.scriptLines`
- `.subtitleTrack`
- `.subtitleItem`
- `.callControls`
- `.section`
- `.sectionHeader`
- `.capabilityGrid`
- `.capabilityCard`
- `.trialGrid`
- `.stepsPanel`
- `.transcriptPanel`
- `.architectureGrid`
- `.finalCta`
- responsive `@media` blocks

- [ ] **Step 3: Apply visual constraints**

Ensure the SCSS uses:

```scss
letter-spacing: 0;
```

for major text and buttons, keeps repeated cards at `border-radius: 8px`, and keeps the hero demo panel as the only large rounded showcase panel. The hero voice sphere should have slow breathing/glow motion and the hero subtitle should cycle quietly in one compact lower-center area.

- [ ] **Step 4: Add responsive constraints**

Add media queries so:

- desktop capability cards are 4 columns,
- desktop trial section is 2 columns,
- mobile stacks sections into 1 column,
- mobile hero transcript and controls do not overlap.

- [ ] **Step 5: Run focused homepage test and dashboard typecheck**

Run:

```powershell
apps/dashboard/node_modules/.bin/vitest.CMD run __tests__/homepage-public.test.tsx
pnpm --filter @ai-call/dashboard test:typecheck
```

Expected: both commands exit with code 0.

## Task 4: Browser Verification

**Files:**
- Read: `apps/dashboard/package.json`
- Verify: `apps/dashboard/app/page.tsx`
- Verify: `apps/dashboard/app/page.module.scss`
- Verify: `apps/dashboard/middleware.ts`

- [ ] **Step 1: Start dashboard dev server**

Run from repo root:

```powershell
pnpm --filter @ai-call/dashboard dev
```

Expected: Next.js starts on `http://localhost:3000`. If port 3000 is occupied, use the running server if it reflects current code, or start another Next.js instance on a different port.

- [ ] **Step 2: Verify public homepage**

Open `/` in the browser.

Expected:

- No dashboard sidebar.
- No dashboard topbar.
- Public nav is visible.
- Hero and voice demo panel render.
- Ecommerce copy is understandable on first read.

- [ ] **Step 3: Verify protected route behavior**

Open `/campaigns` while logged out or without a valid token.

Expected: redirects to `/login?redirect=/campaigns`.

- [ ] **Step 4: Verify responsive layout**

Use desktop and mobile viewport screenshots.

Expected:

- Desktop has centered content, prominent demo panel, 4-column capability cards.
- Mobile stacks content cleanly.
- No text overlap in the hero panel, buttons, or cards.

- [ ] **Step 5: Final verification command**

Run:

```powershell
pnpm --filter @ai-call/dashboard test:typecheck
```

Expected: command exits with code 0.

## Self-Review

- Spec coverage: Tasks cover root public homepage, shell bypass, middleware public access, login default redirect, current-project-based copy, ecommerce script demo, capability packaging, technical credibility, responsiveness, and verification.
- Placeholder scan: The plan contains no unresolved markers or unspecified implementation steps.
- Type consistency: Icon imports are from `lucide-react`, route targets match the design spec, and all modified files live under `apps/dashboard`.
