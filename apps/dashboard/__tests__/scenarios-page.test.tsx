import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowStatus, ScenarioStatus, UserStatus, VoiceCloneStatus } from '@ai-call/shared';
import { useAuthStore } from '@/lib/auth-store';

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

function scenarioItem(overrides: Record<string, unknown> = {}) {
  return {
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
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
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
  // “新建场景”“保存”等写操作按钮受 scenario:update 权限门控，测试用户需具备该权限码
  useAuthStore.getState().setUser({
    id: 'user-1',
    email: 'operator@example.com',
    name: '测试操作员',
    status: UserStatus.ACTIVE,
    roles: ['operator'],
    permissions: ['scenario:update'],
  });
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
  it('只显示有已发布版本的流程，并移除性别字段', () => {
    mocks.flows = [
      flow('published', FlowStatus.PUBLISHED, 1, '当前已发布'),
      flow('draft-new', FlowStatus.DRAFT, 0, '从未发布草稿'),
      flow('draft-edited', FlowStatus.DRAFT, 2, '发布后修改'),
    ];

    openCreate();

    expect(screen.queryByText('性别')).toBeNull();
    const flowRow = screen.getByText('外呼任务流程').closest<HTMLElement>('.scenario-field-row')!;
    const options = within(flowRow).getAllByRole('option').map((item) => item.textContent);
    expect(options).toContain('当前已发布 v1');
    expect(options).toContain('发布后修改 v2（有草稿修改，绑定已发布版本）');
    expect(options.join(' ')).not.toContain('从未发布草稿');
  });

  it('沟通风格支持多选且不显示输入框', () => {
    openCreate();

    const row = screen.getByText('沟通风格').closest<HTMLElement>('.scenario-field-row')!;
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

describe('身份/沟通风格标签化', () => {
  it('身份为单选标签，切换选中且内置标签不可删除', () => {
    openCreate();
    const row = screen.getByText('身份').closest<HTMLElement>('.scenario-field-row')!;
    const a = within(row).getByRole('button', { name: '游戏推广员' });
    const b = within(row).getByRole('button', { name: '医疗助理' });

    fireEvent.click(a);
    expect(a.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(b);
    expect(a.getAttribute('aria-pressed')).toBe('false');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    // 内置标签没有删除按钮
    expect(within(row).queryByRole('button', { name: '删除标签 游戏推广员' })).toBeNull();
    // 已去掉自由输入框，未进入新增编辑态时不应存在任何 input
    expect(row.querySelector('input')).toBeNull();
  });

  it('身份支持新增自定义标签并自动选中，可通过 × 删除', () => {
    openCreate();
    const row = screen.getByText('身份').closest<HTMLElement>('.scenario-field-row')!;

    fireEvent.click(within(row).getByRole('button', { name: '+ 新增' }));
    const input = within(row).getByPlaceholderText('输入后回车确认');
    fireEvent.change(input, { target: { value: '客户成功专员' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const customChip = within(row).getByRole('button', { name: '客户成功专员' });
    expect(customChip.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(row).getByRole('button', { name: '删除标签 客户成功专员' }));
    expect(within(row).queryByRole('button', { name: '客户成功专员' })).toBeNull();
  });

  it('沟通风格支持新增自定义标签、多选与删除，删除自定义标签不影响其他已选风格', () => {
    openCreate();
    const row = screen.getByText('沟通风格').closest<HTMLElement>('.scenario-field-row')!;

    fireEvent.click(within(row).getByRole('button', { name: '亲切' }));
    fireEvent.click(within(row).getByRole('button', { name: '+ 新增' }));
    const input = within(row).getByPlaceholderText('输入后回车确认');
    fireEvent.change(input, { target: { value: '接地气' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(within(row).getByRole('button', { name: '亲切' }).getAttribute('aria-pressed')).toBe('true');
    const customChip = within(row).getByRole('button', { name: '接地气' });
    expect(customChip.getAttribute('aria-pressed')).toBe('true');
    // 内置标签不可删除
    expect(within(row).queryByRole('button', { name: '删除标签 亲切' })).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: '删除标签 接地气' }));
    expect(within(row).queryByRole('button', { name: '接地气' })).toBeNull();
    expect(within(row).getByRole('button', { name: '亲切' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('已保存场景中的自定义身份/风格值回显为可删除的自定义标签', () => {
    mocks.scenarios = [
      scenarioItem({ agentIdentity: '资深客户顾问', communicationStyle: '亲切、接地气' }),
    ];
    render(<ScenariosPage />);
    fireEvent.click(screen.getByRole('button', { name: '进入' }));

    const identityRow = screen.getByText('身份').closest<HTMLElement>('.scenario-field-row')!;
    expect(within(identityRow).getByRole('button', { name: '资深客户顾问' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(identityRow).getByRole('button', { name: '删除标签 资深客户顾问' })).toBeTruthy();

    const styleRow = screen.getByText('沟通风格').closest<HTMLElement>('.scenario-field-row')!;
    expect(within(styleRow).getByRole('button', { name: '接地气' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(styleRow).getByRole('button', { name: '删除标签 接地气' })).toBeTruthy();
  });
});

describe('行业模板', () => {
  it('选择行业模板后把预设内容回显进草稿并提示已应用，仍需手动保存', async () => {
    openCreate();
    fireEvent.change(screen.getByPlaceholderText('请输入场景名称'), {
      target: { value: '模板回显场景' },
    });

    fireEvent.click(screen.getByRole('button', { name: '电商售后回访' }));

    expect(mocks.toastInfo).toHaveBeenCalledWith(expect.stringContaining('电商售后回访'));
    expect(mocks.create).not.toHaveBeenCalled();

    const identityRow = screen.getByText('身份').closest<HTMLElement>('.scenario-field-row')!;
    expect(within(identityRow).getByRole('button', { name: '电商售后客服助理' }).getAttribute('aria-pressed')).toBe('true');

    const styleRow = screen.getByText('沟通风格').closest<HTMLElement>('.scenario-field-row')!;
    expect(within(styleRow).getByRole('button', { name: '亲切' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(styleRow).getByRole('button', { name: '耐心' }).getAttribute('aria-pressed')).toBe('true');

    const goalTextarea = screen.getByText('目标').closest<HTMLElement>('.scenario-field-row')!.querySelector('textarea');
    expect(goalTextarea?.value).toContain('确认订单售后诉求');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0].greeting).toContain('售后事项');
  });
});

describe('已移除字段', () => {
  it('语音&VUI 不再渲染开场白模板与声音风格字段', () => {
    openCreate();
    fireEvent.click(screen.getByRole('button', { name: '语音&VUI' }));
    expect(screen.queryByText('开场白模板')).toBeNull();
    expect(screen.queryByText('声音风格')).toBeNull();
  });

  it('移除表单字段后，编辑已有场景保存仍保留原有开场白与声音风格值', async () => {
    mocks.scenarios = [
      scenarioItem({
        greeting: '您好，这里是原有开场白',
        ttsConfig: { voice: 'Cherry', stylePrompt: '沉稳大气' },
      }),
    ];
    mocks.update.mockResolvedValue(mocks.scenarios[0]);
    render(<ScenariosPage />);
    fireEvent.click(screen.getByRole('button', { name: '进入' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const [, dto] = mocks.update.mock.calls[0] as [string, Record<string, any>];
    expect(dto.greeting).toBe('您好，这里是原有开场白');
    expect(dto.ttsConfig.stylePrompt).toBe('沉稳大气');
  });
});

describe('场景列表操作按钮随状态联动', () => {
  it('已启用场景只显示停用，已停用场景只显示发布', () => {
    mocks.scenarios = [
      scenarioItem({ id: 's-active', scenario: 'scene-active', name: '启用场景', status: ScenarioStatus.ACTIVE }),
      scenarioItem({ id: 's-inactive', scenario: 'scene-inactive', name: '停用场景', status: ScenarioStatus.INACTIVE }),
    ];
    render(<ScenariosPage />);

    const activeRow = screen.getByText('启用场景').closest('tr')!;
    expect(within(activeRow).getByRole('button', { name: '停用' })).toBeTruthy();
    expect(within(activeRow).queryByRole('button', { name: '发布' })).toBeNull();

    const inactiveRow = screen.getByText('停用场景').closest('tr')!;
    expect(within(inactiveRow).getByRole('button', { name: '发布' })).toBeTruthy();
    expect(within(inactiveRow).queryByRole('button', { name: '停用' })).toBeNull();
  });
});

describe('静默处理与插话处理配置组', () => {
  it('渲染独立的静默处理/插话处理分组，废弃话术项不再出现在表单里', () => {
    openCreate();
    // 两个独立分组标题
    expect(screen.getByText('静默处理')).toBeTruthy();
    expect(screen.getByText('插话处理')).toBeTruthy();
    expect(screen.queryByText('对话修复话术')).toBeNull();
    // 静默处理 4 项（超时/轮数/动作为行内布局）
    expect(screen.getByLabelText('静默追问提示词')).toBeTruthy();
    expect(screen.getByLabelText('静默超时时间')).toBeTruthy();
    expect(screen.getByLabelText('连续静默轮数')).toBeTruthy();
    expect(screen.getByLabelText('静默超限动作')).toBeTruthy();
    // 静默超时时间默认 6 秒（6000 毫秒），并有对应 hint
    expect(screen.getByLabelText('静默超时时间').getAttribute('placeholder')).toBe('6000');
    expect(screen.getByText('留空默认 6 秒（6000 毫秒）。')).toBeTruthy();
    // 轮数与动作同一行
    const roundsRow = screen.getByLabelText('连续静默轮数').closest('.scenario-silence-row')!;
    expect(roundsRow.contains(screen.getByLabelText('静默超限动作'))).toBe(true);
    // 默认动作为礼貌结束通话，转人工提示语默认隐藏
    expect(screen.queryByLabelText('转人工提示语')).toBeNull();
    // 已移除的可配置话术不再渲染（运行时用内置默认，仅数据透传）
    expect(screen.queryByLabelText('没听懂回答时')).toBeNull();
    expect(screen.queryByLabelText('客户要求重复时')).toBeNull();
    expect(screen.queryByLabelText('多次失败结束语')).toBeNull();
    expect(screen.queryByLabelText('客户没说话时')).toBeNull();
    // 插话处理默认自然过渡：显示回到流程提示词，模板输入框不显示
    expect(screen.getByLabelText('插话后回到流程')).toBeTruthy();
    expect(screen.getByLabelText('回到流程提示词')).toBeTruthy();
    expect(screen.queryByLabelText('插话承接模板')).toBeNull();
  });

  it('全部留空时提交 payload 省略 dialogRepair（沿用运行时默认）', async () => {
    openCreate();
    fireEvent.change(screen.getByPlaceholderText('请输入场景名称'), {
      target: { value: '默认话术场景' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0].dialogRepair).toBeUndefined();
  });

  it('填写静默配置（提示词/超时/轮数/转人工）后提交 payload 携带对应字段', async () => {
    openCreate();
    fireEvent.change(screen.getByPlaceholderText('请输入场景名称'), {
      target: { value: '静默配置场景' },
    });
    fireEvent.change(screen.getByLabelText('静默追问提示词'), {
      target: { value: '提醒客户还在线，并重复问题' },
    });
    fireEvent.change(screen.getByLabelText('静默超时时间'), {
      target: { value: '8000' },
    });
    fireEvent.change(screen.getByLabelText('连续静默轮数'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('静默超限动作'), {
      target: { value: 'transfer' },
    });
    fireEvent.change(screen.getByLabelText('转人工提示语'), {
      target: { value: '请稍候，马上为您转接人工。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const dialogRepair = mocks.create.mock.calls[0][0].dialogRepair;
    expect(dialogRepair.silencePrompt).toBe('提醒客户还在线，并重复问题');
    expect(dialogRepair.silenceTimeoutMs).toBe(8000);
    expect(dialogRepair.maxSilenceRounds).toBe(3);
    expect(dialogRepair.silenceAction).toBe('transfer');
    expect(dialogRepair.silenceTransferPrompt).toBe('请稍候，马上为您转接人工。');
  });

  it('静默超时/轮数为空或非数字时提交 payload 省略对应字段', async () => {
    openCreate();
    fireEvent.change(screen.getByPlaceholderText('请输入场景名称'), {
      target: { value: '静默非法输入场景' },
    });
    fireEvent.change(screen.getByLabelText('静默追问提示词'), {
      target: { value: '再等等我，马上回来。' },
    });
    fireEvent.change(screen.getByLabelText('静默超时时间'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('连续静默轮数'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const dialogRepair = mocks.create.mock.calls[0][0].dialogRepair;
    expect(dialogRepair.silencePrompt).toBe('再等等我，马上回来。');
    expect(dialogRepair.silenceTimeoutMs).toBeUndefined();
    expect(dialogRepair.maxSilenceRounds).toBeUndefined();
  });

  it('自然过渡模式下填写回到流程提示词，随 payload 提交 sideQuestionResumePrompt', async () => {
    openCreate();
    fireEvent.change(screen.getByPlaceholderText('请输入场景名称'), {
      target: { value: '自然承接场景' },
    });
    fireEvent.change(screen.getByLabelText('回到流程提示词'), {
      target: { value: '先回答客户的插话，再自然带回：{question}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0].dialogRepair).toMatchObject({
      sideQuestionResumePrompt: '先回答客户的插话，再自然带回：{question}',
    });
  });

  it('切换到固定话术模式后才显示模板输入框（回到流程提示词隐藏），并随 payload 一并提交', async () => {
    openCreate();
    fireEvent.change(screen.getByPlaceholderText('请输入场景名称'), {
      target: { value: '模板承接场景' },
    });
    // 切换前模板输入框不存在，自然过渡的提示词输入框存在
    expect(screen.queryByLabelText('插话承接模板')).toBeNull();
    expect(screen.getByLabelText('回到流程提示词')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('插话后回到流程'), {
      target: { value: 'template' },
    });
    // 切换到模板模式后，自然过渡的提示词输入框隐藏
    expect(screen.queryByLabelText('回到流程提示词')).toBeNull();
    fireEvent.change(screen.getByLabelText('插话承接模板'), {
      target: { value: '咱们继续刚才的：{question}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0].dialogRepair).toMatchObject({
      sideQuestionBridge: 'template',
      sideQuestionBridgeTemplate: '咱们继续刚才的：{question}',
    });
  });
});
