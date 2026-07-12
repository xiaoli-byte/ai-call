import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowStatus, ScenarioStatus, VoiceCloneStatus } from '@ai-call/shared';

const mocks = vi.hoisted(() => ({
  flows: [] as any[],
  clones: [] as any[],
  scenarios: [] as any[],
  create: vi.fn(),
  update: vi.fn(),
  deactivate: vi.fn(),
  synthesize: vi.fn(),
  speak: vi.fn(),
  stop: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-scenarios', () => ({
  useScenarios: () => ({ data: mocks.scenarios, error: undefined, isLoading: false }),
  useScenarioMutations: () => ({
    create: mocks.create,
    update: mocks.update,
    deactivate: mocks.deactivate,
  }),
}));

vi.mock('@/hooks/use-task-flows', () => ({
  useTaskFlows: () => ({ data: mocks.flows }),
}));

vi.mock('@/hooks/use-voice-clones', () => ({
  useVoiceClones: () => ({ data: mocks.clones }),
  useVoiceCloneMutations: () => ({ synthesize: mocks.synthesize }),
}));

vi.mock('@/hooks/useTTS', () => ({
  useTTS: () => ({
    state: 'idle',
    isBusy: false,
    error: null,
    voiceParams: { volume: 1, speaker: 'Cherry' },
    updateVoiceParams: vi.fn(),
    speak: mocks.speak,
    stop: mocks.stop,
  }),
}));

vi.mock('@/lib/toast', () => ({
  appToast: {
    success: vi.fn(),
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

import ScenariosPage from '../app/scenarios/page';

function flow(id: string, status: string, version: number, name = id) {
  return {
    id,
    name,
    description: '',
    status,
    version,
    nodes: [],
    edges: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function clone(id: string, status: string, model = 'qwen') {
  return {
    id,
    voiceId: `voice-${id}`,
    name: `克隆音色 ${id}`,
    model,
    description: '',
    status,
    sourceFilename: 'source.wav',
    sourceMimeType: 'audio/wav',
    sourceFileSize: 10,
    sourceAudioUrl: `/api/voice-clones/${id}/audio`,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function openCreate() {
  render(<ScenariosPage />);
  fireEvent.click(screen.getByRole('button', { name: '新建场景' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flows = [];
  mocks.clones = [];
  mocks.scenarios = [];
  mocks.create.mockResolvedValue({
    id: 'scenario-1',
    scenario: 'scene-1',
    name: '测试场景',
    description: '',
    status: ScenarioStatus.ACTIVE,
    systemPrompt: '',
    greeting: '',
    knowledgeBaseId: '',
    allowedTools: [],
    escalationRules: [],
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('/scenarios 创建页', () => {
  it('只显示有已发布版本且未归档的流程，并移除性别字段', () => {
    mocks.flows = [
      flow('published', FlowStatus.PUBLISHED, 1, '当前已发布'),
      flow('draft-new', FlowStatus.DRAFT, 0, '从未发布草稿'),
      flow('draft-edited', FlowStatus.DRAFT, 2, '发布后修改'),
      flow('archived', FlowStatus.ARCHIVED, 3, '已归档'),
    ];

    openCreate();

    expect(screen.queryByText('性别')).toBeNull();
    const flowRow = screen.getByText('外呼任务流程').closest('.scenario-field-row')!;
    const options = within(flowRow).getAllByRole('option').map((item) => item.textContent);
    expect(options).toContain('当前已发布 v1');
    expect(options).toContain('发布后修改 v2（有草稿修改，绑定已发布版本）');
    expect(options.join(' ')).not.toContain('从未发布草稿');
    expect(options.join(' ')).not.toContain('已归档');
  });

  it('沟通风格支持多选且不显示输入框', () => {
    openCreate();

    const row = screen.getByText('沟通风格').closest('.scenario-field-row')!;
    expect(row.querySelector('input')).toBeNull();
    const friendly = within(row).getByRole('button', { name: '亲切' });
    const professional = within(row).getByRole('button', { name: '专业' });
    fireEvent.click(friendly);
    fireEvent.click(professional);
    expect(friendly.getAttribute('aria-pressed')).toBe('true');
    expect(professional.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(friendly);
    expect(friendly.getAttribute('aria-pressed')).toBe('false');
    expect(professional.getAttribute('aria-pressed')).toBe('true');
  });

  it('统一音色下拉只包含内置音色与已入库克隆音色', () => {
    mocks.clones = [
      clone('ready', VoiceCloneStatus.READY),
      clone('preview', VoiceCloneStatus.PREVIEW),
      clone('failed', VoiceCloneStatus.FAILED),
    ];
    openCreate();
    fireEvent.click(screen.getByRole('button', { name: '语音&VUI' }));

    const select = screen.getByLabelText('语音音色');
    const options = within(select).getAllByRole('option').map((item) => item.textContent);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(options.join(' ')).toContain('Cherry · 清晰自然');
    expect(options.join(' ')).toContain('Serena · 温柔舒缓');
    expect(options.join(' ')).toContain('克隆音色 ready · voice-ready');
    expect(options.join(' ')).not.toContain('克隆音色 preview');
    expect(options.join(' ')).not.toContain('克隆音色 failed');
  });

  it('保存克隆音色时提交真实 voiceId、cloneId 和 provider', async () => {
    mocks.clones = [clone('ready', VoiceCloneStatus.READY, 'qwen')];
    openCreate();
    fireEvent.change(screen.getByPlaceholderText('请输入场景名称'), {
      target: { value: '测试场景' },
    });
    fireEvent.click(screen.getByRole('button', { name: '语音&VUI' }));
    fireEvent.change(screen.getByLabelText('语音音色'), {
      target: { value: 'clone:ready' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0].ttsConfig).toMatchObject({
      voice: 'voice-ready',
      voiceCloneId: 'ready',
      provider: 'qwen',
    });
  });

  it('内置音色试听把当前音色、风格和文案传给 TTS', async () => {
    openCreate();
    fireEvent.click(screen.getByRole('button', { name: '语音&VUI' }));
    fireEvent.change(screen.getByLabelText('语音音色'), {
      target: { value: 'builtin:Ethan' },
    });
    fireEvent.change(screen.getByLabelText('试听文案'), {
      target: { value: '请确认这段试听文案。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成并试听' }));

    await waitFor(() => {
      expect(mocks.speak).toHaveBeenCalledWith('请确认这段试听文案。', {
        speaker: 'Ethan',
        instructText: undefined,
      });
    });
  });

  it('克隆音色试听生成带版本参数的可播放音频', async () => {
    mocks.clones = [clone('ready', VoiceCloneStatus.READY, 'cosyvoice')];
    mocks.synthesize.mockResolvedValue({
      voiceClone: {
        ...clone('ready', VoiceCloneStatus.READY, 'cosyvoice'),
        previewAudioUrl: '/api/voice-clones/ready/preview-audio',
        previewGeneratedAt: '2026-07-12T10:00:00.000Z',
      },
      usedFallback: false,
    });
    openCreate();
    fireEvent.click(screen.getByRole('button', { name: '语音&VUI' }));
    fireEvent.change(screen.getByLabelText('语音音色'), {
      target: { value: 'clone:ready' },
    });
    fireEvent.change(screen.getByLabelText('试听文案'), {
      target: { value: '克隆音色试听文案。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成并试听' }));

    await waitFor(() => expect(mocks.synthesize).toHaveBeenCalledWith('ready', {
      text: '克隆音色试听文案。',
    }));
    const renderedAudio = document.querySelector('audio');
    expect(renderedAudio?.getAttribute('src')).toContain('preview-audio?v=');
  });
});
