import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  AudioLines,
  BadgeCheck,
  Blocks,
  BookOpenCheck,
  Bot,
  Check,
  ChevronRight,
  CircleGauge,
  GitBranch,
  Headphones,
  KeyRound,
  LockKeyhole,
  MessagesSquare,
  Network,
  PhoneCall,
  Radar,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

import VoiceConsole from './_components/VoiceConsole';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'AI Call｜企业实时语音智能体',
  description: '将企业知识、业务流程与实时语音连接起来，让每一次客户对话都能被理解、执行与追踪。',
};

const navItems = [
  { label: '语音体验', href: '#experience' },
  { label: '业务闭环', href: '#workflow' },
  { label: '平台能力', href: '#capabilities' },
  { label: '安全治理', href: '#enterprise' },
];

const proofPoints = [
  { label: '自然对话', detail: '支持实时打断与多轮上下文', icon: MessagesSquare },
  { label: '业务执行', detail: '调用工具并回写企业系统', icon: GitBranch },
  { label: '全程可控', detail: '流程、权限与审计统一治理', icon: ShieldCheck },
];

const flow = [
  {
    title: '听懂客户',
    description: '实时识别表达、语气和上下文，在自然插话中保持对话连续。',
    meta: 'ASR · VAD · Context',
    icon: AudioLines,
  },
  {
    title: '判断下一步',
    description: '结合企业知识与流程规则，选择回答、追问、工具调用或人工承接。',
    meta: 'LLM · RAG · Policy',
    icon: Bot,
  },
  {
    title: '完成业务闭环',
    description: '查询订单、创建工单、预约服务，并把处理结果写回现有系统。',
    meta: 'Tools · Handoff · Audit',
    icon: BadgeCheck,
  },
];

const capabilities = [
  {
    title: '实时语音引擎',
    description: '低延迟串联识别、推理与合成，支持客户随时开口打断。',
    icon: Radar,
  },
  {
    title: '可视化流程编排',
    description: '用节点配置问候、判断、动作和结束策略，业务团队也能维护。',
    icon: Workflow,
  },
  {
    title: '企业知识增强',
    description: '接入产品、制度和服务知识，用可信来源约束每一次回答。',
    icon: BookOpenCheck,
  },
  {
    title: '系统与工具连接',
    description: '连接订单、CRM 与工单系统，让语音对话真正推动业务。',
    icon: Blocks,
  },
  {
    title: '人工协同承接',
    description: '识别投诉、争议与高风险意图，携带完整上下文转交坐席。',
    icon: Headphones,
  },
  {
    title: '质量洞察闭环',
    description: '沉淀录音、转写、事件和标签，持续定位问题并优化流程。',
    icon: CircleGauge,
  },
];

const governance = [
  { title: '租户与权限隔离', text: '角色权限覆盖流程、知识、任务与运营数据。', icon: KeyRound },
  { title: '关键变更可审计', text: '发布版本、工具调用和人工操作全链路留痕。', icon: LockKeyhole },
  { title: '部署边界可选择', text: '适配企业网络、模型服务和数据留存要求。', icon: Network },
];

export default function EnterpriseHomePage() {
  return (
    <div className={styles.pageShell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/home" className={styles.brand} aria-label="AI Call 首页">
            <span className={styles.brandSignal} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className={styles.brandName}>AI Call</span>
            <span className={styles.brandDivision}>企业语音智能体</span>
          </Link>

          <nav className={styles.nav} aria-label="首页导航">
            {navItems.map((item) => (
              <a key={item.href} href={item.href}>{item.label}</a>
            ))}
          </nav>

          <div className={styles.headerActions}>
            <Link href="/login" className={styles.loginLink}>登录</Link>
            <Link href="/campaigns" className={styles.consoleLink}>
              进入控制台
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section id="experience" className={styles.hero}>
          <div className={styles.heroSignalRail} aria-hidden="true">
            <span />
          </div>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>
                <span className={styles.statusPulse} />
                企业级实时语音交互
                <span className={styles.eyebrowDivider} />
                LIVE
              </div>
              <h1>
                让 AI 接起每一次
                <span>关键客户对话</span>
              </h1>
              <p>
                把企业知识、业务流程与实时语音连接起来。AI Call 不只回答问题，
                还能查订单、建工单、转人工，让每通电话都有清晰结果。
              </p>

              <div className={styles.heroActions}>
                <a href="#voice-console" className={styles.primaryAction}>
                  <AudioLines aria-hidden="true" />
                  现在就和 AI 说话
                  <ArrowRight aria-hidden="true" />
                </a>
                <a href="#workflow" className={styles.textAction}>
                  查看如何完成业务
                  <ChevronRight aria-hidden="true" />
                </a>
              </div>

              <div className={styles.heroAssurance} aria-label="体验说明">
                <span><Check aria-hidden="true" /> 无需注册</span>
                <span><Check aria-hidden="true" /> 浏览器直接体验</span>
                <span><Check aria-hidden="true" /> 随时可以结束</span>
              </div>
            </div>

            <div id="voice-console" className={styles.consoleColumn}>
              <div className={styles.consoleLabel}>
                <span>体验线路 / 01</span>
                <strong>企业售后服务专线</strong>
              </div>
              <VoiceConsole />
            </div>
          </div>

          <div className={styles.proofStrip}>
            <div className={styles.proofIntro}>
              <Sparkles aria-hidden="true" />
              一次对话，完整体验从理解到执行
            </div>
            {proofPoints.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className={styles.proofItem}>
                  <Icon aria-hidden="true" />
                  <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                </div>
              );
            })}
          </div>
        </section>

        <section id="workflow" className={styles.workflowSection}>
          <div className={styles.sectionHeading}>
            <span className={styles.sectionKicker}>CONVERSATION → ACTION</span>
            <h2>一通电话，不止得到一句回答</h2>
            <p>将自然对话变成可执行、可复盘、可持续优化的企业工作流。</p>
          </div>

          <div className={styles.flowRail}>
            {flow.map((item, index) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className={styles.flowCard}>
                  <div className={styles.flowIndex}>0{index + 1}</div>
                  <span className={styles.flowIcon}><Icon aria-hidden="true" /></span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <small>{item.meta}</small>
                </article>
              );
            })}
          </div>
        </section>

        <section id="capabilities" className={styles.capabilitySection}>
          <div className={styles.sectionHeadingSplit}>
            <div>
              <span className={styles.sectionKicker}>PLATFORM CAPABILITIES</span>
              <h2>复杂语音业务，交给一套平台</h2>
            </div>
            <p>从一条业务专线开始，逐步扩展到售后回访、批量通知、营销触达与服务受理。</p>
          </div>

          <div className={styles.capabilityGrid}>
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className={styles.capabilityCard}>
                  <span><Icon aria-hidden="true" /></span>
                  <div><h3>{item.title}</h3><p>{item.description}</p></div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="enterprise" className={styles.enterpriseSection}>
          <div className={styles.enterpriseLead}>
            <span className={styles.sectionKicker}>BUILT FOR ENTERPRISE</span>
            <h2>从第一通试用电话开始，就按生产标准设计</h2>
            <p>能力可以快速验证，治理边界必须从一开始就清晰。</p>
            <Link href="/campaigns" className={styles.enterpriseLink}>
              查看企业控制台 <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.governanceList}>
            {governance.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title}>
                  <span><Icon aria-hidden="true" /></span>
                  <div><h3>{item.title}</h3><p>{item.text}</p></div>
                  <ChevronRight aria-hidden="true" />
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.finalCta}>
          <div className={styles.ctaIcon} aria-hidden="true"><PhoneCall /></div>
          <div>
            <span className={styles.sectionKicker}>START WITH A REAL WORKFLOW</span>
            <h2>让下一通客户电话，成为业务完成的起点</h2>
            <p>从一条真实流程开始验证企业语音智能体的价值。</p>
          </div>
          <div className={styles.finalActions}>
            <a href="#voice-console" className={styles.ghostAction}>再次体验语音</a>
            <Link href="/campaigns" className={styles.lightAction}>
              进入控制台 <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/home" className={styles.footerBrand}>AI Call</Link>
        <p>企业实时语音智能体平台</p>
        <span>VOICE · WORKFLOW · INTELLIGENCE</span>
      </footer>
    </div>
  );
}
