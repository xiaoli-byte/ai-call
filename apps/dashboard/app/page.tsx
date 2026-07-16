import Link from 'next/link';
import type { Metadata } from 'next';
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
  LogIn,
  Megaphone,
  Mic2,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

import Grainient from '../components/Grainient';
import WebCallPanel from '../components/home/WebCallPanel';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'AI Call - 智能语音外呼解决方案',
  description: '面向电商售后回访、批量通知和营销触达的智能语音外呼系统。',
};

const navItems = [
  { label: '智能外呼', href: '#hero' },
  { label: '解决方案', href: '#solution' },
];

const capabilities = [
  { title: '批量任务调度', description: '按任务名单和时间窗发起外呼。', icon: ClipboardList },
  { title: '话术流程编排', description: '节点化配置问候、分支、动作和结束策略。', icon: Workflow },
  { title: '实时语音交互', description: 'ASR、LLM、TTS 串联完成自然对话。', icon: Mic2 },
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

const heroCaptions = [
  {
    title: '正在确认订单与签收状态',
    text: 'AI 正在核对客户称呼、订单编号和售后回访目的。',
  },
  {
    title: '识别物流异常诉求',
    text: '客户表达未收到包裹，系统判断为签收异常与售后跟进。',
  },
  {
    title: '调用订单与物流工具',
    text: '外呼助理查询订单状态，准备给出驿站代签、补发或人工承接方案。',
  },
  {
    title: '完成闭环或转人工',
    text: '投诉、争议、强烈不满等风险情况会进入人工承接流程。',
  },
];

const heroVoiceBallColors = {
  primary: '#9fffc6',
  secondary: '#5227FF',
  accent: '#efe6a6',
};

const trialTranscript = [
  { role: 'agent', text: '您好，我是星选商城售后助理，关于您购买的无线耳机订单想做一次售后确认。' },
  { role: 'user', text: '我看到物流签收了，但我没拿到。' },
  { role: 'agent', text: '我帮您查到是小区驿站代签，预计今晚可取。若您不方便领取，我可以为您创建补发工单。' },
  { role: 'user', text: '帮我转人工吧。' },
  { role: 'agent', text: '好的，我将为您转接售后专员，并同步订单和物流异常记录。' },
];

export default function HomePage() {
  return (
    <div className={styles.landingPage}>
      <header className={styles.publicNav}>
        <Link href="/" className={styles.brand} aria-label="AI Call 首页">
          <span className={styles.brandMark}>
            <Megaphone aria-hidden="true" />
          </span>
          <span>
            <strong>AI Call</strong>
            <small>智能外呼</small>
          </span>
        </Link>

        <nav className={styles.navLinks} aria-label="首页导航">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className={styles.navActions}>
          <Link href="/tasks" className={styles.consoleLink}>
            控制台
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main className='pb-4'>
        <section id="hero" className={styles.hero}>
          <div className={styles.heroText}>
            <h1>
              <span>新一代智能语音外呼</span>，让每通电话都有价值
            </h1>
            <p className={styles.heroCopy}>
              自动执行批量通知、售后回访与营销触达；通过新一代大模型外呼机器人，提升外呼效率！
            </p>
          </div>

          <div className={styles.demoPanel} aria-label="智能外呼语音演示">
            {/* 左上角场景徽标由 WebCallPanel 渲染：显示当前选中话术名称 */}
            <div className={styles.voiceSphere}>
              <span className={styles.waveRing} />
              <span className={styles.waveRing} />
              <Grainient
                className={styles.waveCore}
                color1={heroVoiceBallColors.primary}
                color2={heroVoiceBallColors.secondary}
                color3={heroVoiceBallColors.accent}
                timeSpeed={3}
                colorBalance={0}
                warpStrength={0.7}
                warpFrequency={5}
                warpSpeed={2}
                warpAmplitude={50}
                blendAngle={0}
                blendSoftness={0.05}
                rotationAmount={500}
                noiseScale={2}
                grainAmount={0.1}
                grainScale={2}
                grainAnimated={false}
                contrast={1.5}
                gamma={1.05}
                saturation={1}
                centerX={0}
                centerY={0}
                zoom={1.3}
              />
            </div>
            <div className={styles.subtitleTrack} aria-label="电商售后话术轮播" aria-live="polite">
              {heroCaptions.map((line) => (
                <p key={line.title} className={styles.subtitleItem}>
                  <strong>{line.title}</strong>
                  <span>{line.text}</span>
                </p>
              ))}
            </div>
            <WebCallPanel />
          </div>
        </section>

        <section id="ecommerce-demo" className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionKicker}>Ecommerce Trial</span>
              <h2>电商话术流程试用</h2>
            </div>
            <p>
              不需要真实拨号，也能看懂系统如何完成一次售后外呼：先确认身份，再识别问题，随后调用工具并给出处理结果。
            </p>
          </div>

          <div className={styles.trialGrid}>
            <div className={styles.stepsPanel}>
              {flowSteps.map((step, index) => (
                <div key={step.title} className={styles.flowStep}>
                  <span>{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.transcriptPanel}>
              <div className={styles.transcriptHeader}>
                <span>
                  <PhoneCall aria-hidden="true" />
                  模拟通话记录
                </span>
                <strong>已识别转人工意图</strong>
              </div>
              <div className={styles.bubbleList}>
                {trialTranscript.map((line, index) => (
                  <p
                    key={`${line.role}-${index}`}
                    className={line.role === 'agent' ? styles.agentBubble : styles.userBubble}
                  >
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="solution" className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionKicker}>Solution</span>
              <h2>
                <span>一站式</span>智能外呼解决方案
              </h2>
            </div>
          </div>

          <div className={styles.capabilityGrid}>
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className={styles.capabilityCard}>
                  <span className={styles.cardIcon}>
                    <Icon aria-hidden="true" />
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        
        <section className={styles.finalCta}>
          <div>
            <span className={styles.sectionKicker}>Ready</span>
            <h2>从一段电商售后话术，看到完整智能外呼闭环</h2>
            <p>
              进入控制台后可以继续查看外呼任务、话术流程、通话质检和人工承接模块。
            </p>
          </div>
          <div className={styles.finalActions}>
            <Link href="/tasks" className={styles.primaryAction}>
              进入控制台
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
