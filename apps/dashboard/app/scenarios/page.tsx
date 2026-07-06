'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  RefreshCw,
  Save,
  Search,
  Volume2,
} from 'lucide-react';
import {
  FlowStatus,
  ScenarioStatus,
  type CreateScenarioDto,
  type EscalationRule,
  type ScenarioConfig,
} from '@ai-call/shared';
import { useScenarioMutations, useScenarios } from '@/hooks/use-scenarios';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { useVoiceClones } from '@/hooks/use-voice-clones';
import { cn } from '@/lib/utils';
import { appToast } from '@/lib/toast';
import { ScenarioPageTitle, ScenarioTab, ScenarioTabs } from '@/components/scenario-workbench/page-chrome';

import styles from './scenarios.module.scss';

type DetailTab = 'robot' | 'voice';

interface ScenarioDraft {
  id?: string;
  scenario: string;
  name: string;
  description: string;
  status: ScenarioStatus;
  ttsVoice: string;
  ttsVoiceCloneId: string;
  ttsAge: string;
  ttsGender: string;
  ttsSpeakingRate: string;
  ttsPitch: string;
  ttsStylePrompt: string;
  agentIdentity: string;
  communicationStyle: string;
  communicationStylePrompt: string;
  businessGoal: string;
  llmConstraintsText: string;
  systemPrompt: string;
  greeting: string;
  knowledgeBaseId: string;
  allowedToolsText: string;
  escalationRules: EscalationRule[];
  defaultFlowId: string;
  updatedAt?: string;
}

const EMPTY_DRAFT: ScenarioDraft = {
  scenario: '',
  name: '',
  description: '',
  status: ScenarioStatus.ACTIVE,
  ttsVoice: '',
  ttsVoiceCloneId: '',
  ttsAge: '',
  ttsGender: '',
  ttsSpeakingRate: '',
  ttsPitch: '',
  ttsStylePrompt: '',
  agentIdentity: '',
  communicationStyle: '',
  communicationStylePrompt: '',
  businessGoal: '',
  llmConstraintsText: '',
  systemPrompt: '',
  greeting: '',
  knowledgeBaseId: '',
  allowedToolsText: '',
  escalationRules: [],
  defaultFlowId: '',
};

const IDENTITY_PRESETS = ['游戏推广员', '活动运营员', '医疗助理', '审计专员', '保险专员', '行政助理'];
const STYLE_PRESETS = ['亲切', '自然', '口语化', '专业', '活泼', '严肃'];
function toDraft(scenario?: ScenarioConfig): ScenarioDraft {
  if (!scenario) return { ...EMPTY_DRAFT, escalationRules: [] };
  return {
    id: scenario.id,
    scenario: scenario.scenario ?? '',
    name: scenario.name ?? '',
    description: scenario.description ?? '',
    status: scenario.status ?? ScenarioStatus.ACTIVE,
    ttsVoice: scenario.ttsConfig?.voice ?? '',
    ttsVoiceCloneId: scenario.ttsConfig?.voiceCloneId ?? '',
    ttsAge: scenario.ttsConfig?.age ?? '',
    ttsGender: scenario.ttsConfig?.gender ?? '',
    ttsSpeakingRate: scenario.ttsConfig?.speakingRate !== undefined ? String(scenario.ttsConfig.speakingRate) : '',
    ttsPitch: scenario.ttsConfig?.pitch !== undefined ? String(scenario.ttsConfig.pitch) : '',
    ttsStylePrompt: scenario.ttsConfig?.stylePrompt ?? '',
    agentIdentity: scenario.agentIdentity ?? '',
    communicationStyle: scenario.communicationStyle ?? '',
    communicationStylePrompt: scenario.communicationStylePrompt ?? '',
    businessGoal: scenario.businessGoal ?? '',
    llmConstraintsText: (scenario.llmConstraints ?? []).join('\n'),
    systemPrompt: scenario.systemPrompt ?? '',
    greeting: scenario.greeting ?? '',
    knowledgeBaseId: scenario.knowledgeBaseId ?? '',
    allowedToolsText: (scenario.allowedTools ?? []).join('\n'),
    escalationRules: (scenario.escalationRules ?? []).map((item) => ({ ...item })),
    defaultFlowId: scenario.defaultFlowId ?? '',
    updatedAt: scenario.updatedAt,
  };
}

function splitLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberValue(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createScenarioKey(name: string) {
  const readable = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return readable || `scene_${Date.now().toString(36)}`;
}

function draftToDto(draft: ScenarioDraft): CreateScenarioDto {
  return {
    scenario: draft.scenario.trim() || createScenarioKey(draft.name),
    name: draft.name.trim(),
    description: draft.description,
    status: draft.status,
    ttsConfig: {
      voice: draft.ttsVoice || undefined,
      voiceCloneId: draft.ttsVoiceCloneId || undefined,
      provider: draft.ttsVoiceCloneId ? 'cosyvoice' : undefined,
      age: draft.ttsAge || undefined,
      gender: draft.ttsGender || undefined,
      speakingRate: numberValue(draft.ttsSpeakingRate),
      pitch: numberValue(draft.ttsPitch),
      stylePrompt: draft.ttsStylePrompt || undefined,
    },
    agentIdentity: draft.agentIdentity,
    communicationStyle: draft.communicationStyle,
    communicationStylePrompt: draft.communicationStyle || undefined,
    businessGoal: draft.businessGoal,
    llmConstraints: splitLines(draft.llmConstraintsText),
    greeting: draft.greeting,
    escalationRules: draft.escalationRules,
    defaultFlowId: draft.defaultFlowId || undefined,
  };
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function statusLabel(status?: ScenarioStatus) {
  return status === ScenarioStatus.INACTIVE ? '停用' : '启用';
}

function BadgeStatus({ status }: { status?: ScenarioStatus }) {
  const active = status !== ScenarioStatus.INACTIVE;
  return (
    <span className={`badge badge-dot ${active ? 'badge-success' : 'badge-neutral'}`}>
      {statusLabel(status)}
    </span>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <ScenarioTab active={active} onClick={onClick}>
      {children}
    </ScenarioTab>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="scenario-field-row">
      <label className="scenario-field-label">{label}</label>
      <div className="scenario-field-control">{children}</div>
    </div>
  );
}

function CountedInput({
  value,
  maxLength,
  onChange,
  placeholder,
}: {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="scenario-counted-field">
      <input
        className="form-input"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <span>{value.length}/{maxLength}</span>
    </div>
  );
}

function CountedTextarea({
  value,
  maxLength,
  onChange,
  minHeight = 132,
}: {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  minHeight?: number;
}) {
  return (
    <div className="scenario-counted-field textarea">
      <textarea
        className="form-textarea"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        style={{ minHeight }}
      />
      <span>{value.length}/{maxLength}</span>
    </div>
  );
}

function PresetChips({
  values,
  selected,
  onSelect,
}: {
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="scenario-chip-list">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={`scenario-chip ${selected.includes(value) ? 'selected' : ''}`}
          onClick={() => onSelect(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function ScenarioListView({
  scenarios,
  isLoading,
  onCreate,
  onEdit,
  onDeactivate,
  onPublish,
}: {
  scenarios: ScenarioConfig[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (scenario: ScenarioConfig) => void;
  onDeactivate: (scenario: ScenarioConfig) => void;
  onPublish: (scenario: ScenarioConfig) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = scenarios.filter((item) => {
    const text = `${item.name} ${item.scenario} ${item.description}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  return (
    <div className={styles.workbench}>
      <ScenarioPageTitle title="大模型场景列表" breadcrumb="智能外呼 / 场景管理 / 大模型场景列表" />

      <ScenarioTabs>
        <ScenarioTab active>大模型场景列表</ScenarioTab>
        <ScenarioTab>测试记录</ScenarioTab>
      </ScenarioTabs>

      <div className="scenario-guide">
        <div className="scenario-guide-title">创建方式</div>
        <div className="scenario-guide-steps">
          <div className="scenario-guide-step">
            <div className="scenario-guide-icon">1</div>
            <div>
              <div className="scenario-guide-step-title">步骤1：新建场景</div>
              <p>从场景名称开始，逐步补充身份、风格和业务目标。</p>
            </div>
          </div>
          <div className="scenario-guide-step">
            <div className="scenario-guide-icon">2</div>
            <div>
              <div className="scenario-guide-step-title">步骤2：配置场景内容</div>
              <p>配置机器人身份、业务目标、回复边界和外呼流程。</p>
            </div>
          </div>
          <div className="scenario-guide-step">
            <div className="scenario-guide-icon">3</div>
            <div>
              <div className="scenario-guide-step-title">步骤3：调试并发布场景</div>
              <p>通过语音调试或测试记录验证效果，发布后即可用于外呼任务。</p>
            </div>
          </div>
        </div>
      </div>

      <div className="scenario-toolbar">
        <button type="button" className="btn" onClick={onCreate}>
          <Plus size={15} />
          新建场景
        </button>
        <div className="scenario-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="请输入场景名称搜索" />
          <Search size={15} />
        </div>
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => location.reload()} title="刷新">
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="table-wrap scenario-table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>说明</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>最近更新时间</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((scenario) => (
                <tr key={scenario.id ?? scenario.scenario}>
                  <td style={{ fontWeight: 500 }}>{scenario.name}</td>
                  <td className="text-secondary">{scenario.description || '-'}</td>
                  <td><BadgeStatus status={scenario.status} /></td>
                  <td className="text-secondary">{formatDate(scenario.createdAt)}</td>
                  <td className="text-secondary">{formatDate(scenario.updatedAt)}</td>
                  <td>
                    <div className="scenario-row-actions">
                      <button type="button" onClick={() => onEdit(scenario)}>进入</button>
                      <button type="button" onClick={() => onPublish(scenario)}>发布</button>
                      <button type="button" onClick={() => onDeactivate(scenario)}>停用</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty" style={{ padding: '34px 12px' }}>
                      <div className="empty-title">{isLoading ? '场景加载中' : '暂无匹配场景'}</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RobotConfigTab({
  draft,
  setDraft,
  flows,
}: {
  draft: ScenarioDraft;
  setDraft: React.Dispatch<React.SetStateAction<ScenarioDraft>>;
  flows: Array<{ id: string; name: string; version: number; status: string }>;
}) {
  return (
    <>
      <section className="scenario-section">
        <h2>人物与风格</h2>
        <FieldRow label="名称">
          <CountedInput
            value={draft.name}
            maxLength={100}
            onChange={(value) => setDraft((prev) => ({ ...prev, name: value }))}
            placeholder="请输入场景名称"
          />
        </FieldRow>
        <FieldRow label="描述">
          <CountedInput
            value={draft.description}
            maxLength={140}
            onChange={(value) => setDraft((prev) => ({ ...prev, description: value }))}
            placeholder="请输入场景描述"
          />
        </FieldRow>
        <FieldRow label="性别">
          <select
            className="form-select"
            value={draft.ttsGender}
            onChange={(event) => setDraft((prev) => ({ ...prev, ttsGender: event.target.value }))}
          >
            <option value="">未设置</option>
            <option value="female">女</option>
            <option value="male">男</option>
            <option value="neutral">中性</option>
          </select>
        </FieldRow>
        <FieldRow label="年龄">
          <div className="scenario-inline-input">
            <input
              className="form-input"
              value={draft.ttsAge}
              onChange={(event) => setDraft((prev) => ({ ...prev, ttsAge: event.target.value }))}
            />
            <span>岁</span>
          </div>
        </FieldRow>
        <FieldRow label="身份">
          <PresetChips
            values={IDENTITY_PRESETS}
            selected={draft.agentIdentity}
            onSelect={(value) => setDraft((prev) => ({ ...prev, agentIdentity: value }))}
          />
          <input
            className="form-input"
            value={draft.agentIdentity}
            onChange={(event) => setDraft((prev) => ({ ...prev, agentIdentity: event.target.value }))}
          />
        </FieldRow>
        <FieldRow label="沟通风格">
          <PresetChips
            values={STYLE_PRESETS}
            selected={draft.communicationStyle}
            onSelect={(value) => setDraft((prev) => ({ ...prev, communicationStyle: value }))}
          />
          <input
            className="form-input"
            value={draft.communicationStyle}
            onChange={(event) => setDraft((prev) => ({ ...prev, communicationStyle: event.target.value }))}
          />
        </FieldRow>
      </section>

      <section className="scenario-section">
        <h2>业务描述</h2>
        <FieldRow label="目标">
          <CountedTextarea
            value={draft.businessGoal}
            maxLength={1000}
            onChange={(value) => setDraft((prev) => ({ ...prev, businessGoal: value }))}
            minHeight={150}
          />
        </FieldRow>
        <FieldRow label="外呼任务流程">
          <div className="scenario-flow-row">
            <select
              className="form-select"
              value={draft.defaultFlowId}
              onChange={(event) => setDraft((prev) => ({ ...prev, defaultFlowId: event.target.value }))}
            >
              <option value="">没有流程</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name} v{flow.version}{flow.status === FlowStatus.PUBLISHED ? '' : '（草稿）'}
                </option>
              ))}
            </select>
            <button type="button" className="scenario-text-link">去新建</button>
          </div>
        </FieldRow>
        <FieldRow label="回复边界">
          <CountedTextarea
            value={draft.llmConstraintsText}
            maxLength={3000}
            onChange={(value) => setDraft((prev) => ({ ...prev, llmConstraintsText: value }))}
            minHeight={154}
          />
        </FieldRow>
      </section>
    </>
  );
}

function VoiceTab({
  draft,
  setDraft,
}: {
  draft: ScenarioDraft;
  setDraft: React.Dispatch<React.SetStateAction<ScenarioDraft>>;
}) {
  const { data: voiceClones } = useVoiceClones();
  const clones = voiceClones ?? [];

  return (
    <section className="scenario-section">
      <h2>语音与 VUI</h2>
      <FieldRow label="TTS 音色">
        <div className="scenario-voice-select-row">
          <select
            className="form-select"
            value={draft.ttsVoiceCloneId}
            onChange={(event) => {
              const cloneId = event.target.value;
              const clone = clones.find((item) => item.id === cloneId);
              setDraft((prev) => ({
                ...prev,
                ttsVoiceCloneId: cloneId,
                ttsVoice: clone?.voiceId ?? prev.ttsVoice,
              }));
            }}
          >
            <option value="">使用内置/手动音色</option>
            {clones.map((clone) => (
              <option key={clone.id} value={clone.id}>
                {clone.name} / {clone.voiceId}
              </option>
            ))}
          </select>
          <input
            className="form-input"
            value={draft.ttsVoice}
            onChange={(event) => setDraft((prev) => ({
              ...prev,
              ttsVoice: event.target.value,
              ttsVoiceCloneId: '',
            }))}
            placeholder="Cherry"
          />
          <Link href="/voice-clones" className="scenario-text-link">去克隆</Link>
        </div>
      </FieldRow>
      <FieldRow label="声音风格">
        <textarea
          className="form-textarea"
          value={draft.ttsStylePrompt}
          onChange={(event) => setDraft((prev) => ({ ...prev, ttsStylePrompt: event.target.value }))}
          style={{ minHeight: 108 }}
        />
      </FieldRow>
      <FieldRow label="开场白模板">
        <textarea
          className="form-textarea"
          value={draft.greeting}
          onChange={(event) => setDraft((prev) => ({ ...prev, greeting: event.target.value }))}
          style={{ minHeight: 108 }}
        />
      </FieldRow>
    </section>
  );
}

function ScenarioDetailView({
  draft,
  setDraft,
  flows,
  mode,
  submitting,
  onBack,
  onSave,
}: {
  draft: ScenarioDraft;
  setDraft: React.Dispatch<React.SetStateAction<ScenarioDraft>>;
  flows: Array<{ id: string; name: string; version: number; status: string }>;
  mode: 'create' | 'edit';
  submitting: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('robot');

  return (
    <div className={cn(styles.workbench, styles.detail)}>
      <ScenarioPageTitle
        title="大模型场景管理详情"
        breadcrumb={<>智能外呼 / 场景管理 / {draft.name || '新建场景'} / 大模型场景管理详情</>}
        onBack={onBack}
        backLabel="返回列表"
        extra={(
          <div className="scenario-debug-toggle">
            <Volume2 size={15} />
            <span>语音调试</span>
            <span className="scenario-toggle-dot" />
          </div>
        )}
      />

      <ScenarioTabs>
        <TabButton active={tab === 'robot'} onClick={() => setTab('robot')}>机器人配置</TabButton>
        <TabButton active={tab === 'voice'} onClick={() => setTab('voice')}>语音&VUI</TabButton>
      </ScenarioTabs>

      <div className="scenario-detail-body">
        {tab === 'robot' && <RobotConfigTab draft={draft} setDraft={setDraft} flows={flows} />}
        {tab === 'voice' && <VoiceTab draft={draft} setDraft={setDraft} />}
      </div>

      <div className="scenario-save-bar">
        <button type="button" className="btn" onClick={onSave} disabled={submitting}>
          <Save size={15} />
          {submitting ? '保存中...' : '保存'}
        </button>
        <span>最近保存：{mode === 'create' ? '-' : formatDate(draft.updatedAt)}</span>
      </div>
    </div>
  );
}

export default function ScenariosPage() {
  const { data, error, isLoading } = useScenarios();
  const { data: flowsData } = useTaskFlows();
  const flows = flowsData ?? [];
  const scenarios = data ?? [];
  const { create, update, deactivate } = useScenarioMutations();
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [mode, setMode] = useState<'create' | 'edit'>('edit');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [draft, setDraft] = useState<ScenarioDraft>(() => ({ ...EMPTY_DRAFT, escalationRules: [] }));
  const [submitting, setSubmitting] = useState(false);

  const selectedScenario = useMemo(
    () => scenarios.find((item) => (item.id ?? item.scenario) === selectedKey),
    [scenarios, selectedKey],
  );

  useEffect(() => {
    if (view !== 'detail') return;
    setDraft(mode === 'create' ? { ...EMPTY_DRAFT, escalationRules: [] } : toDraft(selectedScenario));
  }, [mode, selectedScenario, view]);

  function openCreate() {
    setMode('create');
    setSelectedKey('');
    setDraft({ ...EMPTY_DRAFT, escalationRules: [] });
    setView('detail');
  }

  function openEdit(scenario: ScenarioConfig) {
    setMode('edit');
    setSelectedKey(scenario.id ?? scenario.scenario);
    setDraft(toDraft(scenario));
    setView('detail');
  }

  async function saveDraft() {
    const dto = draftToDto(draft);
    if (!dto.name) {
      appToast.error('请填写场景名称');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const created = await create(dto);
        setMode('edit');
        setSelectedKey(created.id ?? created.scenario);
        setDraft(toDraft(created));
        appToast.success('场景已创建');
      } else {
        const saved = await update(draft.id ?? (selectedKey || draft.scenario), dto);
        setSelectedKey(saved.id ?? saved.scenario);
        setDraft(toDraft(saved));
        appToast.success('场景已保存');
      }
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(scenario: ScenarioConfig) {
    setSubmitting(true);
    try {
      await deactivate(scenario.id ?? scenario.scenario);
      appToast.success('场景已停用');
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(scenario: ScenarioConfig) {
    setSubmitting(true);
    try {
      await update(scenario.id ?? scenario.scenario, { status: ScenarioStatus.ACTIVE });
      appToast.success('场景已发布');
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-title" style={{ color: 'var(--danger)' }}>场景加载失败</div>
          <div className="empty-desc">{error instanceof Error ? error.message : '请检查后端服务'}</div>
        </div>
      </div>
    );
  }

  if (view === 'detail') {
    return (
      <ScenarioDetailView
        draft={draft}
        setDraft={setDraft}
        flows={flows}
        mode={mode}
        submitting={submitting}
        onBack={() => setView('list')}
        onSave={saveDraft}
      />
    );
  }

  return (
    <ScenarioListView
      scenarios={scenarios}
      isLoading={isLoading}
      onCreate={openCreate}
      onEdit={openEdit}
      onDeactivate={handleDeactivate}
      onPublish={handlePublish}
    />
  );
}
