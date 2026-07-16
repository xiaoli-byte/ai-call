/**
 * 业务场景定义 - 三大内置场景
 *
 * 1. COLLECTION  - 贷后催收/逾期催收/还款日提醒
 * 2. ECOMMERCE   - 电商售后订单外呼
 * 3. PRESALE     - 售前邀约（如4S店试驾邀请）
 */
export enum Scenario {
  COLLECTION = 'collection',
  ECOMMERCE = 'ecommerce',
  PRESALE = 'presale',
}

export type ScenarioKey = string;

export const ScenarioStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;
export type ScenarioStatus = (typeof ScenarioStatus)[keyof typeof ScenarioStatus];

export interface TtsVoiceConfig {
  /** TTS 音色/发音人，例如 Cherry、中文女。 */
  voice?: string;
  /** 克隆音色记录 ID；存在时可回查提示音频与提示文本。 */
  voiceCloneId?: string;
  /** TTS/音色供应商，例如 qwen、cosyvoice。 */
  provider?: string;
  /** 声音年龄段，例如 young/adult/senior 或中文描述。 */
  age?: string;
  /** 声音性别/声线描述。 */
  gender?: string;
  /** 语速倍率。 */
  speakingRate?: number;
  /** 音高倍率或供应商支持的 pitch 值。 */
  pitch?: number;
  /** 指令式 TTS 的风格提示词。 */
  stylePrompt?: string;
  /** 音色人设描述，注入 LLM system prompt，使话术语气与音色匹配。 */
  voicePersona?: string;
}

export interface DialogRepairConfig {
  /** 无应答重问话术，支持 {question} 占位符；运行时会把 {question} 替换为当前节点未答的问题话术。 */
  noInputPrompt?: string;
  /** 无应答次数用尽的收尾话术 */
  noInputGiveUpPrompt?: string;
  /** 未理解回答时的澄清话术，支持 {question}；运行时会把 {question} 替换为当前节点未答的问题话术。 */
  noMatchPrompt?: string;
  /** 澄清次数用尽的收尾话术 */
  noMatchGiveUpPrompt?: string;
  /** 用户要求重复时的应答话术，支持 {question}；运行时会把 {question} 替换为当前节点未答的问题话术。 */
  repeatAckPrompt?: string;
  /** 用户要求稍等时的应答话术 */
  holdAckPrompt?: string;
  /** 用户表示"我有问题想问"时的应答话术 */
  questionRequestAckPrompt?: string;
  /** 语义识别服务异常时请用户重说的话术 */
  sttRetryPrompt?: string;
  /** 语义识别持续异常的收尾话术 */
  sttGiveUpPrompt?: string;
  /** 插问答不上来时的兜底话术 */
  sideQuestionFallbackPrompt?: string;
  /** 插问额度用尽、先回主流程的话术 */
  sideQuestionDeferPrompt?: string;
  /** 插话承接方式：natural=LLM 一次生成融合（默认）；template=固定模板拼接 */
  sideQuestionBridge?: 'natural' | 'template';
  /** template 模式的承接话术，支持 {question}；运行时会把 {question} 替换为当前节点未答的问题话术。 */
  sideQuestionBridgeTemplate?: string;
  /**
   * natural 模式下「插话后回到流程」的提示词：AI 回答完客户插话后，按此提示
   * 把对话自然带回主流程未答的问题。支持 {question} 占位符。留空使用内置默认。
   */
  sideQuestionResumePrompt?: string;
  /**
   * 插话应答过渡语：识别为插话后、查询答案前先播的一句短话（答案生成与
   * 过渡语播放并行，压缩体感等待）。留空使用内置默认。
   */
  sideQuestionAck?: string;
  /** 静默追问提示词：静默超时后 AI 按此提示生成追问话术（非固定文案）。留空默认：复述上一轮对话内容并保证上下文自然衔接 */
  silencePrompt?: string;
  /** 静默超时时间（毫秒）：用户静默超过该时长即触发静默追问。留空跟随系统默认（6000） */
  silenceTimeoutMs?: number;
  /** 连续静默轮数上限：连续静默超过该轮数后执行 silenceAction。留空跟随系统默认（2） */
  maxSilenceRounds?: number;
  /** 静默超限动作：hangup=礼貌挂机（默认）；transfer=转人工 */
  silenceAction?: 'hangup' | 'transfer';
  /** 转人工前的提示话术（silenceAction=transfer 时播报） */
  silenceTransferPrompt?: string;
}

/**
 * 对话修复话术的展示用默认值，供前端表单做输入框 placeholder。
 * 注意：运行时真正生效的默认值在 Python 侧（voice-agent），此处仅用于前端展示。
 */
export const DIALOG_REPAIR_DEFAULTS: Required<DialogRepairConfig> = {
  noInputPrompt: '抱歉，我没有听到您的回答。{question}',
  noInputGiveUpPrompt: '暂时没有听到您的回答，我们稍后再联系您。',
  noMatchPrompt: '抱歉，我还没理解您的回答。{question}',
  noMatchGiveUpPrompt: '抱歉，我暂时无法确认您的回答，我们稍后再联系您。',
  repeatAckPrompt: '好的，我再说一遍。{question}',
  holdAckPrompt: '好的，您请说。',
  questionRequestAckPrompt: '好的，您请说。',
  sttRetryPrompt: '语音服务刚才有些延迟，请您再说一次。',
  sttGiveUpPrompt: '语音服务暂时无法完成识别，我们稍后再联系您。',
  sideQuestionFallbackPrompt: '这部分我需要帮您确认后回复。',
  sideQuestionDeferPrompt: '这个问题我暂时无法确认，我们先继续刚才的流程。',
  sideQuestionBridge: 'natural',
  sideQuestionBridgeTemplate: '回到刚才的问题，{question}',
  sideQuestionResumePrompt:
    '回答后，用口语自然地把对话带回主流程中客户尚未回答的问题：「{question}」。'
    + '衔接要顺滑，保持该问题的原意，但不要逐字照抄，也不要使用『回到刚才的问题』这类生硬转折。',
  sideQuestionAck: '好的，稍等哈，我帮您看一下。',
  silencePrompt: '- 复述上一轮对话的内容\n- 保证上下文自然衔接',
  silenceTimeoutMs: 6000,
  maxSilenceRounds: 2,
  silenceAction: 'hangup',
  silenceTransferPrompt: '请稍等，正在为您转接人工客服。',
};

export interface ScenarioConfig {
  /** 持久化配置 ID；内置 fallback 场景可能没有。 */
  id?: string;
  /** 场景标识 */
  scenario: ScenarioKey;
  /** 场景中文名 */
  name: string;
  /** 场景描述 */
  description: string;
  /** 启用状态 */
  status?: ScenarioStatus;
  /** TTS 语音配置 */
  ttsConfig?: TtsVoiceConfig;
  /** 当前场景中的 Agent 身份 */
  agentIdentity?: string;
  /** 面向运营人员的沟通风格标签/描述 */
  communicationStyle?: string;
  /** 注入 LLM/TTS 的沟通风格 prompt */
  communicationStylePrompt?: string;
  /** 场景业务目标 */
  businessGoal?: string;
  /** 对 LLM 生成的约束清单 */
  llmConstraints?: string[];
  /** Agent 系统提示词（人设/知识边界/行为底线） */
  systemPrompt: string;
  /** Agent 问候语（通话接通后第一句话） */
  greeting: string;
  /** 知识库 ID（关联向量库 collection） */
  knowledgeBaseId: string;
  /** 该场景下可调用的 Function 工具白名单 */
  allowedTools: string[];
  /** 转人工阈值（达到这些条件时转人工） */
  escalationRules: EscalationRule[];
  /** 场景默认绑定的外呼流程。 */
  defaultFlowId?: string;
  /** 对话修复话术（无应答重问/未理解澄清/STT 异常重试/插问兜底等） */
  dialogRepair?: DialogRepairConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface EscalationRule {
  /** 触发条件描述 */
  description: string;
  /** 关键词触发列表 */
  keywords?: string[];
  /** 情绪触发（如 angry/distressed） */
  emotions?: string[];
  /** 连续未理解次数 */
  consecutiveMisses?: number;
}

export interface CreateScenarioDto {
  scenario: ScenarioKey;
  name: string;
  description?: string;
  status?: ScenarioStatus;
  ttsConfig?: TtsVoiceConfig;
  agentIdentity?: string;
  communicationStyle?: string;
  communicationStylePrompt?: string;
  businessGoal?: string;
  llmConstraints?: string[];
  systemPrompt?: string;
  greeting?: string;
  knowledgeBaseId?: string;
  allowedTools?: string[];
  escalationRules?: EscalationRule[];
  defaultFlowId?: string;
  dialogRepair?: DialogRepairConfig;
}

export type UpdateScenarioDto = Partial<Omit<CreateScenarioDto, 'defaultFlowId'>> & {
  defaultFlowId?: string | null;
};

export const SCENARIO_CONFIGS: Record<Scenario, ScenarioConfig> = {
  [Scenario.COLLECTION]: {
    scenario: Scenario.COLLECTION,
    name: '贷后催收',
    description: '信用卡/贷款还款提醒、逾期催收',
    status: ScenarioStatus.ACTIVE,
    ttsConfig: {
      voice: 'Cherry',
      age: 'adult',
      gender: 'female',
      stylePrompt: '专业、平稳、克制，语速中等。',
    },
    agentIdentity: '贷后还款提醒助理',
    communicationStyle: '专业平和',
    communicationStylePrompt: '专业平和，不威胁、不施压，先确认身份和沟通意愿。',
    businessGoal: '提醒客户了解还款信息，并在合规边界内推动还款或转人工协商。',
    llmConstraints: [
      '不得威胁、恐吓或评价客户信用状况',
      '不得承诺减免、延期或审批结果',
      '涉及金额、日期、罚息必须来自工具或任务变量',
    ],
    systemPrompt: `你是一名专业的贷后催收助理，通过电话提醒客户还款。

【身份】你不是放款方，是协助客户了解还款信息、提醒还款日期、协商还款方案的助理。
【掌握信息】可调用工具查询：客户姓名、应还金额、还款日、逾期天数、罚息。
【不掌握信息】不能减免罚息、不能修改利率、不能审批延期。客户提出这些诉求时统一回复："这部分需要专员审核，我帮您转接人工"。
【语气】专业平和，不卑不亢。不用"尊敬的客户"，直接称呼姓氏+先生/女士。
【底线】
- 不说"必须今天还款""不还款后果自负"等威胁性话术
- 客户情绪激动时（骂人、哭泣）立即安抚并转人工
- 客户提出困难（失业、生病）记录后转人工协商
- 全程不评论客户信用状况`,
    greeting: '您好，我是{company}的还款提醒助理，关于您{product}的还款事项想跟您确认一下，现在方便吗？',
    knowledgeBaseId: 'kb-collection',
    allowedTools: [
      'query_repayment_info',
      'calculate_penalty',
      'create_extension_request',
      'transfer_to_human',
    ],
    escalationRules: [
      { description: '客户情绪激动', emotions: ['angry', 'distressed'] },
      { description: '客户提出减免罚息/延期还款', keywords: ['减免', '延期', '协商', '困难'] },
      { description: '连续 2 次未理解客户意图', consecutiveMisses: 2 },
    ],
  },

  [Scenario.ECOMMERCE]: {
    scenario: Scenario.ECOMMERCE,
    name: '电商售后',
    description: '订单售后回访、退款进度查询、退换货预约',
    status: ScenarioStatus.ACTIVE,
    ttsConfig: {
      voice: 'Cherry',
      age: 'young-adult',
      gender: 'female',
      stylePrompt: '亲切、耐心、自然，像真人客服沟通。',
    },
    agentIdentity: '电商售后客服助理',
    communicationStyle: '亲切耐心',
    communicationStylePrompt: '亲切耐心，先共情再确认事实，不做超出规则的承诺。',
    businessGoal: '确认订单售后问题，推进退款、退换货或工单处理。',
    llmConstraints: [
      '不得承诺一定退款或突破售后规则',
      '涉及金额、物流、时间节点必须调用工具或引用知识库',
      '客户投诉质量问题时记录并转专员处理',
    ],
    systemPrompt: `你是一名电商售后客服助理，通过电话回访客户、查询订单状态、协助退换货。

【身份】你是售后助理，可以查询订单、查询退款进度、为用户预约上门取件。
【掌握信息】可调用工具查询：订单详情、物流状态、退款进度；可创建：上门取件预约、售后工单。
【不掌握信息】不能直接审批退款、不能修改订单金额、不能改变退款规则。
【语气】亲切耐心，像朋友沟通。称呼"亲"或姓氏+女士/先生。
【底线】
- 退款规则以知识库为准，不乱承诺"一定退款"
- 涉及金额、时间等数字必须查知识库后回答，查不到就说"帮您确认后回复"
- 客户投诉商品质量问题时记录工单转专员
- 不评价竞品`,
    greeting: '您好，我是{company}的售后助理，关于您订单{orderNo}的售后事项想跟您确认，现在方便吗？',
    knowledgeBaseId: 'kb-ecommerce',
    allowedTools: [
      'query_order',
      'query_refund_status',
      'create_pickup_appointment',
      'create_after_sale_ticket',
      'transfer_to_human',
    ],
    escalationRules: [
      { description: '客户投诉商品质量问题', keywords: ['质量', '假货', '投诉'] },
      { description: '客户要求直接退款', keywords: ['直接退款', '不退就投诉'] },
      { description: '客户连续 2 次表达不满', emotions: ['angry'] },
    ],
  },

  [Scenario.PRESALE]: {
    scenario: Scenario.PRESALE,
    name: '售前邀约',
    description: '4S店试驾、产品体验、活动邀约',
    status: ScenarioStatus.ACTIVE,
    ttsConfig: {
      voice: 'Cherry',
      age: 'young-adult',
      gender: 'female',
      stylePrompt: '热情、轻松、不过度推销。',
    },
    agentIdentity: '4S 店邀约助理',
    communicationStyle: '热情专业',
    communicationStylePrompt: '热情专业，主动介绍亮点，但客户拒绝时立即礼貌收束。',
    businessGoal: '邀请潜客到店试驾或参加活动，并收集意向与预约时间。',
    llmConstraints: [
      '不得直接报价或承诺优惠',
      '不得评价竞品车型',
      '客户明确拒绝时停止推销并礼貌结束',
    ],
    systemPrompt: `你是一名4S店邀约助理，通过电话邀请潜客到店试驾、参加活动。

【身份】你是邀约助理，可以介绍车型亮点、查询活动信息、为客户预约到店时间。
【掌握信息】可调用工具查询：车型参数、活动详情、门店位置；可创建：试驾预约。
【不掌握信息】不能承诺价格优惠、不能改变活动规则、不能直接报价。
【语气】热情专业，像朋友推荐好东西。不催促、不强求。
【底线】
- 价格相关问题统一回复"具体优惠需到店与销售顾问详谈"
- 客户表示无兴趣时礼貌结束，不打扰
- 不评价竞品车型
- 不承诺试驾一定有现车`,
    greeting: '您好，我是{company}的邀约助理，最近我们有{activity}活动，想邀请您到店体验，现在方便聊两句吗？',
    knowledgeBaseId: 'kb-presale',
    allowedTools: [
      'query_car_model',
      'query_activity',
      'create_test_drive_appointment',
      'transfer_to_human',
    ],
    escalationRules: [
      { description: '客户明确表示无兴趣', keywords: ['不需要', '没兴趣', '别打了'] },
      { description: '客户询问具体价格', keywords: ['多少钱', '价格', '优惠'] },
    ],
  },
};
