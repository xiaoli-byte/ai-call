import Link from 'next/link';

function StatIcon({ name }: { name: string }) {
  const props = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'phone':
      return (
        <svg {...props}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case 'trend':
      return (
        <svg {...props}>
          <path d="M23 6 13.5 15.5l-5-5L1 18" />
          <path d="M17 6h6v6" />
        </svg>
      );
    default:
      return null;
  }
}

const STATS = [
  { label: '今日外呼', value: '0', meta: 'Mock 数据', icon: 'phone', accent: false },
  { label: '接通率', value: '--', meta: '需启动后端', icon: 'check', accent: false },
  { label: '平均通话时长', value: '--', meta: '需启动后端', icon: 'clock', accent: false },
  { label: '意向转化', value: '--', meta: '需启动后端', icon: 'trend', accent: false },
];

export default function HomePage() {
  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">概览</h1>
          <p className="subtitle">
            欢迎回来，这里是 AI Call 智能外呼平台总览
          </p>
        </div>
        <div className="page-actions">
          <Link href="/tasks/new" className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建外呼任务
          </Link>
        </div>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-header">
              <span className="stat-label">{stat.label}</span>
              <div className="stat-icon">
                <StatIcon name={stat.icon} />
              </div>
            </div>
            <div className={`stat-value ${stat.accent ? 'stat-value-primary' : ''}`}>
              {stat.value}
            </div>
            <div className="stat-meta">{stat.meta}</div>
          </div>
        ))}
      </div>

      {/* 系统架构 */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">系统架构</div>
            <div className="card-subtitle">FreeSWITCH + NestJS + Voice Agent 完整技术栈</div>
          </div>
          <span className="badge badge-primary">v1.0</span>
        </div>
        <pre className="architecture">{`┌───────────────────────────────────────────────────────────────┐
│  Next.js Dashboard（本控制台）                                 │
│  任务管理 / 通话监控 / 知识库管理 / 场景配置                  │
└────────────────────────┬──────────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼──────────────────────────────────────┐
│  NestJS 后端（@ai-call/api）                                   │
│  外呼任务调度 / Function Calling 业务接口 / 知识库检索         │
│  Tools: query_order / query_repayment_info / create_ticket ... │
└──────┬───────────────────────────────────┬───────────────────┘
       │ HTTP（任务派发 + 工具调用）        │ HTTP（RAG 检索）
       ▼                                    ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│  Voice Agent              │    │  知识库（向量检索）        │
│  (services/voice-agent)   │    │  Chroma / Qdrant           │
│  ┌─────────┐ ┌────────┐   │    │  - 贷后催收政策            │
│  │ STT     │ │ LLM    │   │    │  - 电商退换货规则          │
│  │ FunASR  │ │ GPT-4o │   │    │  - 4S店试驾流程            │
│  │ /Deepgram│ │/DeepSeek│  │    └────────────────────────────┘
│  └─────────┘ └────────┘   │
│  ┌─────────┐ ┌────────┐   │
│  │ TTS     │ │ RAG    │   │
│  │ Qwen-TTS│ │        │   │
│  │ /CosyVoice│ │       │   │
│  └─────────┘ └────────┘   │
└──────────┬─────────────────┘
           │ WebSocket (音频流)
┌──────────▼─────────────────┐
│  FreeSWITCH + mod_audio_fork│
│  - SIP 中继接运营商/Twilio   │
│  - RTP 音频 fork 给 Agent   │
│  - AMD 应答机检测           │
│  - 录音 / CDR 话单          │
└──────────┬─────────────────┘
           │ SIP / RTP
           ▼
        PSTN 电话网`}</pre>
      </div>

      {/* 快速开始 */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">快速开始</div>
            <div className="card-subtitle">从零到第一通 AI 外呼电话</div>
          </div>
        </div>
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.9, fontSize: '13.5px' }}>
          <p>1. 复制 <code>.env.example</code> 为 <code>.env</code>，按需填写 API Key（不填使用 Mock）</p>
          <p>2. 启动依赖服务：<code>docker compose -f freeswitch/docker-compose.yml up -d</code></p>
          <p>3. 安装依赖：<code>pnpm install</code></p>
          <p>4. 启动全部服务：<code>pnpm dev</code></p>
          <p>5. 单独调试 Agent：<code>pnpm dev:agent -- --cli</code></p>
        </div>
        <div className="row-actions" style={{ marginTop: 20 }}>
          <Link href="/tasks" className="btn">前往外呼任务</Link>
          <Link href="/scenarios" className="btn btn-secondary">查看场景配置</Link>
          <Link href="/voice-demo" className="btn btn-ghost">体验语音演示</Link>
        </div>
      </div>

      {/* 三栏功能卡片 */}
      <div className="grid grid-3">
        <div className="card">
          <div className="card-title">支持的 AI 供应商</div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <ul style={{ paddingLeft: 0, listStyle: 'none', color: 'var(--text-secondary)', lineHeight: 1.9, fontSize: '13px' }}>
            <li>• <strong>STT</strong>: FunASR（推荐）/ Deepgram / 阿里云 / Mock</li>
            <li>• <strong>LLM</strong>: GPT-4o / DeepSeek / Mock</li>
            <li>• <strong>TTS</strong>: Qwen-TTS（推荐）/ CosyVoice / Mock</li>
          </ul>
        </div>
        <div className="card">
          <div className="card-title">三大业务场景</div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <ul style={{ paddingLeft: 0, listStyle: 'none', color: 'var(--text-secondary)', lineHeight: 1.9, fontSize: '13px' }}>
            <li>• 贷后催收（含还款提醒/逾期催收）</li>
            <li>• 电商售后（订单查询/退换货）</li>
            <li>• 售前邀约（4S 店试驾）</li>
          </ul>
        </div>
        <div className="card">
          <div className="card-title">核心特性</div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <ul style={{ paddingLeft: 0, listStyle: 'none', color: 'var(--text-secondary)', lineHeight: 1.9, fontSize: '13px' }}>
            <li>• Provider 抽象层 — 混合栈切换</li>
            <li>• RAG 知识库 — 防幻觉</li>
            <li>• Function Calling — 业务闭环</li>
            <li>• 转人工规则 — 兜底安全</li>
          </ul>
        </div>
      </div>
    </div>
  );
}