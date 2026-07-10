/**
 * FreeSWITCH 挂断原因 / provider-code 单一权威分类表
 *
 * 历史上这套知识散落在两处、彼此漂移:
 *  - apps/api/src/freeswitch/freeswitch-errors.ts —— originate `-ERR` reply 的
 *    provider-code 分类(是否可重试 / 是否可对外暴露)。
 *  - apps/api/src/tasks/tasks.service.ts —— CHANNEL_HANGUP_COMPLETE 的 hangup-cause
 *    到终态(COMPLETED / FAILED / NO_ANSWER)的映射。
 *
 * 两者共享同一套 FreeSWITCH/Q.850 cause 名称空间,但各自维护一份集合,极易失配。
 * 本表把每个 cause 收敛为一条权威记录,上述两处集合全部从这里**派生**。
 *
 * 字段各自独立,分别刻画同一 cause 在两条链路上的语义:
 *  - `terminalStatus`:该 cause 作为**挂断原因**、且通话**未接通**时的终态。
 *    省略(undefined)表示"这是一个纯派单期 provider-code,不会作为挂断原因出现"
 *    (如 DUPLICATE / GATEWAY_DOWN / SERVICE_UNAVAILABLE)。派生 NO_ANSWER/FAILED
 *    hangup 集合时,只认显式取到 'no_answer' / 'failed' 的行。
 *  - `retryable`:作为 originate `-ERR` provider-code 时,是否可安全重拨。
 *  - `safeToExpose`:是否可把该 code 原样透传给 API 客户端(不泄露 PII/基础设施)。
 *    未列入(safeToExpose=false)的 code 在脱敏时统一归 UNKNOWN。
 */

import { TaskStatus } from './tasks.js';

/** 挂断原因可映射到的终态(通话未接通时)。 */
export type HangupTerminalStatus =
  | TaskStatus.COMPLETED
  | TaskStatus.FAILED
  | TaskStatus.NO_ANSWER;

export interface HangupCauseClassification {
  /**
   * 该 cause 作为挂断原因、且未接通时的终态。
   * 省略表示纯派单期 provider-code,不参与 hangup 终态派生。
   */
  terminalStatus?: HangupTerminalStatus;
  /** 作为 originate `-ERR` provider-code 时是否可安全重拨。 */
  retryable: boolean;
  /** 是否可将该 code 原样对外暴露(否则脱敏为 UNKNOWN)。 */
  safeToExpose: boolean;
}

const FAILED = TaskStatus.FAILED;
const NO_ANSWER = TaskStatus.NO_ANSWER;

/**
 * 权威分类表。key 为规范化(UPPER_SNAKE)后的 cause 名称。
 *
 * 分组仅为可读性,派生逻辑只看字段值:
 *  1. 可重试 provider-code(retryable=true,均可对外暴露)。
 *  2. 其余可对外暴露的 provider-code(retryable=false)。
 *  3. 仅作为挂断原因出现的 NO_ANSWER cause(非 provider-code,不可暴露)。
 *  4. 仅作为挂断原因出现的 FAILED cause(非 provider-code,不可暴露)。
 */
export const HANGUP_CAUSE_CLASSIFICATIONS: Readonly<
  Record<string, HangupCauseClassification>
> = {
  // ── 1. 可重试 provider-code ───────────────────────────────────────────────
  DESTINATION_OUT_OF_ORDER: { terminalStatus: FAILED, retryable: true, safeToExpose: true },
  GATEWAY_DOWN: { retryable: true, safeToExpose: true }, // 纯派单期,非挂断原因
  NETWORK_OUT_OF_ORDER: { terminalStatus: FAILED, retryable: true, safeToExpose: true },
  NORMAL_TEMPORARY_FAILURE: { terminalStatus: FAILED, retryable: true, safeToExpose: true },
  RECOVERY_ON_TIMER_EXPIRE: { terminalStatus: FAILED, retryable: true, safeToExpose: true },
  REQUESTED_CHAN_UNAVAIL: { terminalStatus: FAILED, retryable: true, safeToExpose: true },
  SERVICE_UNAVAILABLE: { retryable: true, safeToExpose: true }, // 纯派单期,非挂断原因
  SWITCH_CONGESTION: { terminalStatus: FAILED, retryable: true, safeToExpose: true },

  // ── 2. 其余可对外暴露的 provider-code(不可重试) ─────────────────────────
  // DUPLICATE = CALL_ALREADY_ACTIVE_PROVIDER_CODE:重复 origination_uuid 的 re-originate,
  // 不是派单失败(呼叫已存在),由 outbox 幂等吞掉,绝不重拨/置 FAILED。
  DUPLICATE: { retryable: false, safeToExpose: true }, // 纯派单期,非挂断原因
  CALL_REJECTED: { terminalStatus: NO_ANSWER, retryable: false, safeToExpose: true },
  INVALID_NUMBER_FORMAT: { terminalStatus: FAILED, retryable: false, safeToExpose: true },
  NO_ANSWER: { terminalStatus: NO_ANSWER, retryable: false, safeToExpose: true },
  NO_ROUTE_DESTINATION: { terminalStatus: FAILED, retryable: false, safeToExpose: true },
  NORMAL_CLEARING: { terminalStatus: NO_ANSWER, retryable: false, safeToExpose: true },
  ORIGINATOR_CANCEL: { terminalStatus: NO_ANSWER, retryable: false, safeToExpose: true },
  SUBSCRIBER_ABSENT: { terminalStatus: NO_ANSWER, retryable: false, safeToExpose: true },
  UNALLOCATED_NUMBER: { terminalStatus: FAILED, retryable: false, safeToExpose: true },
  USER_BUSY: { terminalStatus: NO_ANSWER, retryable: false, safeToExpose: true },
  USER_NOT_REGISTERED: { terminalStatus: FAILED, retryable: false, safeToExpose: true },

  // ── 3. 仅作为挂断原因的 NO_ANSWER cause(非 provider-code) ────────────────
  NO_USER_RESPONSE: { terminalStatus: NO_ANSWER, retryable: false, safeToExpose: false },

  // ── 4. 仅作为挂断原因的 FAILED cause(非 provider-code) ───────────────────
  NO_ROUTE: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  BEARERCAPABILITY_NOTAVAIL: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  INCOMPATIBLE_DESTINATION: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  PROTOCOL_ERROR: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  MEDIA_ERROR: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  MEDIA_TIMEOUT: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  AUDIO_FORK_ERROR: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  BACKGROUND_JOB_FAILED: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
  EVENT_LOSS_RECONCILED: { terminalStatus: FAILED, retryable: false, safeToExpose: false },
};

function collectCodes(
  predicate: (entry: HangupCauseClassification) => boolean,
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const [code, entry] of Object.entries(HANGUP_CAUSE_CLASSIFICATIONS)) {
    if (predicate(entry)) set.add(code);
  }
  return set;
}

/** provider-code:可安全重拨的集合(派生自表中 retryable=true)。 */
export const RETRYABLE_PROVIDER_CODES: ReadonlySet<string> = collectCodes(
  (entry) => entry.retryable,
);

/** provider-code:可原样对外暴露的集合(派生自表中 safeToExpose=true)。 */
export const SAFE_PROVIDER_CODES: ReadonlySet<string> = collectCodes(
  (entry) => entry.safeToExpose,
);

/** hangup-cause:未接通时判 NO_ANSWER 的集合(派生自表中 terminalStatus=NO_ANSWER)。 */
export const NO_ANSWER_HANGUP_CAUSES: ReadonlySet<string> = collectCodes(
  (entry) => entry.terminalStatus === NO_ANSWER,
);

/** hangup-cause:判定为致命失败的集合(派生自表中 terminalStatus=FAILED)。 */
export const FAILED_HANGUP_CAUSES: ReadonlySet<string> = collectCodes(
  (entry) => entry.terminalStatus === FAILED,
);

/**
 * 查表:返回规范化后 cause 的分类记录,未收录返回 undefined。
 * 规范化交由调用方完成(key 已是 UPPER_SNAKE)。
 */
export function classifyHangupCause(
  normalizedCause: string | undefined,
): HangupCauseClassification | undefined {
  if (!normalizedCause) return undefined;
  return HANGUP_CAUSE_CLASSIFICATIONS[normalizedCause];
}
