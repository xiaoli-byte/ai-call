# Public Homepage Design

## Goal

Replace the current root dashboard overview at `/` with an independent public homepage for the AI Call intelligent outbound calling project.

The page should look like a polished product website, not an admin console. It should reference the provided Aliyun VoicePica-style layout: white background, clear top navigation, a strong hero headline, and a large central voice-call demo panel. The demo scenario must use the project's existing ecommerce after-sales outbound flow.

## Audience

Primary visitors are people seeing the project for the first time: recruiters, technical reviewers, and potential product users. The copy must help them understand the product within the first screen:

- What it is: an AI voice outbound calling system.
- What it does: batch outbound calls, ecommerce after-sales callbacks, order/logistics/refund handling, and manual handoff.
- Why it is credible: it is backed by the existing project architecture, including task scheduling, flow orchestration, RAG, Function Calling, call quality, and analytics.

Avoid abstract AI slogans. Use plain, outcome-oriented Chinese copy based on existing project capabilities.

## Route And Authentication

`/` becomes the public homepage and is accessible without login.

The existing admin console remains protected. Public visitors can enter it through top navigation actions:

- `登录` links to `/login`.
- `控制台` links to the authenticated console entry, initially `/campaigns`.

Middleware should allow unauthenticated access to `/` and `/login`, while keeping dashboard modules such as `/campaigns`, `/tasks`, `/task-flows`, `/analytics`, `/quality`, `/handoffs`, `/scenarios`, `/knowledge`, and system routes protected.

When a logged-in user visits `/login`, redirect them to `/campaigns`, not `/`. After a successful login, the default redirect should also be `/campaigns` unless a `redirect` query parameter is present.

The public page must not render the dashboard sidebar or topbar. The existing `ClientLayout` can keep wrapping authenticated routes, but it should bypass the shell for `/` the same way it already bypasses the shell for `/login`.

## Page Structure

### Top Navigation

Use a lightweight public nav, separate from the dashboard sidebar.

Items:

- Brand: `AI Call`
- `智能外呼`
- `电商话术试用`
- `解决方案`
- `技术架构`
- `登录`
- `控制台`

The nav should be simple and readable. It does not need dropdowns for this iteration.

### Hero

Headline:

`智能语音外呼，让每通电话都有价值`

Supporting copy:

Describe the product in one sentence using concrete language:

`自动执行批量通知、售后回访与营销触达。通过电商订单售后话术流程，演示身份确认、物流查询、补发预约、转人工兜底的完整闭环。`

Primary actions:

- `体验电商话术`
- `进入控制台`

The first action can scroll to the ecommerce script section. The second links to `/campaigns`.

### Voice Demo Panel

The hero includes a large rounded demo panel inspired by the reference page and the provided screen recording. The middle interaction should feel like a lightweight live voice-call stage, not a chat transcript panel.

Visual elements:

- Soft white-blue panel background.
- Central colorful voice sphere with slow breathing, glow, and subtle rotation-like motion.
- Small status label: `电商售后回访 · 试用中`, kept visually quiet.
- Call controls using familiar phone/keypad symbols.
- A single compact subtitle area in the lower center of the panel.
- Subtitle lines should cycle through ecommerce after-sales call turns. Do not render three large chat cards in the hero panel at the same time.

Subtitle sequence:

- `AI 外呼：张先生您好，我是星选商城售后助理，想和您确认订单 A1024 的签收情况。`
- `客户：包裹还没收到，短信说已经签收了。`
- `AI 外呼：我已为您查询物流，可能是驿站代签。我可以帮您预约补发，或为您转接人工专员继续处理。`

This is a static visual product demonstration for the homepage. It does not need to initiate a real call. The detailed ecommerce dialogue remains in the `电商话术流程试用` section below the fold.

### Solution Capabilities

Section title:

`一站式智能外呼解决方案`

Supporting copy should state that the platform covers the full outbound lifecycle.

Cards should package current project modules into user-understandable benefits:

- `批量任务调度`: 按活动、名单和时间窗发起外呼。
- `话术流程编排`: 节点化配置问候、分支、动作和结束策略。
- `实时语音交互`: STT、LLM、TTS 串联完成自然对话。
- `业务工具调用`: 查询订单、退款、预约取件并回写业务系统。
- `知识库兜底`: 通过 RAG 约束政策、金额和时效回复。
- `人工承接`: 投诉、争议或情绪异常时自动转人工。
- `通话质检`: 沉淀录音、转写、标签和问题归因。
- `数据闭环`: 统计接通率、完成率、转人工和意向结果。

### Ecommerce Script Trial

Section title:

`电商话术流程试用`

This section should make the scenario readable without requiring a live phone call.

Flow steps:

1. `身份与订单确认`: 核对客户称呼、订单号、购买商品和回访目的。
2. `识别售后意图`: 区分未签收、物流异常、退款进度、换货诉求。
3. `调用业务工具`: 查询订单状态，预约补发、取件或创建售后工单。
4. `完成闭环或转人工`: 输出处理结果；投诉、争议、强烈不满时转人工。

Transcript sample:

- `您好，我是星选商城售后助理，关于您购买的无线耳机订单想做一次售后确认。`
- `我看到物流签收了，但我没拿到。`
- `我帮您查到是小区驿站代签，预计今晚可取。若您不方便领取，我可以为您创建补发工单。`
- `帮我转人工吧。`
- `好的，我将为您转接售后专员，并同步订单和物流异常记录。`

### Technical Credibility

Add a compact section that turns the existing architecture into customer-facing trust signals.

Use concise labels:

- `FreeSWITCH 语音接入`
- `Voice Agent 实时编排`
- `NestJS 业务接口`
- `Next.js 控制台`
- `RAG 知识库`
- `Function Calling 闭环`

Avoid showing the old ASCII architecture diagram on the public homepage. It is too technical for first-glance comprehension.

## Component Boundaries

Keep the implementation local to the dashboard app:

- Modify `apps/dashboard/app/page.tsx` for the public homepage content.
- Replace or heavily revise `apps/dashboard/app/page.module.scss` for homepage-specific styles.
- Update `apps/dashboard/components/client-layout.tsx` so `/` renders without the dashboard shell.
- Update `apps/dashboard/middleware.ts` so `/` is public and login redirects target `/campaigns`.
- Update `apps/dashboard/app/login/page.tsx` so successful default login goes to `/campaigns`, while still honoring an explicit redirect if present.

Do not refactor unrelated dashboard pages.

## Responsive Behavior

Desktop:

- Center content in a max-width container.
- Keep the hero demo panel large and prominent.
- Use 4-column capability cards and a 2-column ecommerce trial panel.

Mobile:

- Collapse nav links, keeping brand plus `登录` and `控制台`.
- Reduce hero headline size.
- Keep transcript text readable and avoid overlap with call controls.
- Stack capability cards and ecommerce trial panels into one column.

Text must not overflow buttons, cards, or the hero demo panel.

## Visual Direction

Use a clean white product-site look with blue as the primary accent. The page can use a soft blue-to-lavender demo panel similar to the reference screenshot, but it should not become a one-color blue dashboard.

Cards should use 8px or smaller radius except for the large hero demo panel, which may use a larger radius to match the reference.

Avoid decorative blobs and generic marketing illustrations. The visual centerpiece is the voice demo panel.

## Error Handling And Fallbacks

The homepage is static and should not depend on live backend data. If the backend is down, `/` should still render.

Navigation links should be ordinary Next.js links:

- `/login` for login.
- `/campaigns` for console entry.

Middleware handles whether `/campaigns` redirects to login.

## Testing

Run:

```powershell
pnpm --filter @ai-call/dashboard test:typecheck
```

Then start the dashboard and verify in browser:

- `/` renders the public homepage without sidebar/topbar.
- `/` is accessible when logged out.
- `/login` remains accessible when logged out.
- Login success lands on `/campaigns` by default.
- Protected dashboard pages still redirect to `/login` when logged out.
- Desktop and mobile viewports have no overlapping text or broken hero controls.

## Out Of Scope

- Real telephone calling from the homepage.
- New backend APIs.
- New image generation or video assets.
- Full marketing site with pricing, docs, or blog pages.
- Reworking the authenticated dashboard navigation beyond the route changes required for `/`.
