import { Injectable } from '@nestjs/common';
import type {
  GlobalApiPluginConfig,
  GlobalConfig,
  GlobalOutboundNumberListEntry,
  GlobalOutboundRulesConfig,
  GlobalVariableConfig,
  UserProfile,
  UpdateGlobalConfigDto,
} from '@ai-call/shared';
import {
  DEFAULT_API_PLUGINS,
  DEFAULT_GLOBAL_VARIABLES,
  DEFAULT_OUTBOUND_RULES,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  auditActorFromUser,
  withCreateAuditFields,
  type AuditActor,
} from '../common/audit-fields.js';
import { toPrismaJson } from '../common/prisma-json.js';

type GlobalConfigRecord = {
  id: string;
  globalVariables: unknown;
  apiPlugins: unknown;
  outboundRules?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_CONFIG_ID = 'default';

export type OutboundPolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | 'blocked_number'
        | 'outside_call_window'
        | 'holiday_blocked'
        | 'daily_limit_reached';
      message: string;
      details?: Record<string, unknown>;
    };

@Injectable()
export class GlobalConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<GlobalConfig> {
    const existing = await this.client.findUnique({
      where: { id: DEFAULT_CONFIG_ID },
    });
    if (existing) return this.toDomain(existing);

    const created = await this.client.create({
      data: {
        id: DEFAULT_CONFIG_ID,
        globalVariables: toPrismaJson(DEFAULT_GLOBAL_VARIABLES),
        apiPlugins: toPrismaJson(DEFAULT_API_PLUGINS),
        outboundRules: toPrismaJson(DEFAULT_OUTBOUND_RULES),
      },
    });
    return this.toDomain(created);
  }

  async update(dto: UpdateGlobalConfigDto, user?: UserProfile): Promise<GlobalConfig> {
    const actor = auditActorFromUser(user);
    const data: Record<string, unknown> = {};
    if (dto.globalVariables !== undefined) {
      data.globalVariables = toPrismaJson(dto.globalVariables);
    }
    if (dto.apiPlugins !== undefined) {
      data.apiPlugins = toPrismaJson(dto.apiPlugins);
    }
    if (dto.outboundRules !== undefined) {
      data.outboundRules = toPrismaJson(this.normalizeOutboundRules(dto.outboundRules, actor));
    }
    if (Object.keys(data).length === 0) return this.get();

    const createOutboundRules = this.normalizeOutboundRules(
      dto.outboundRules ?? DEFAULT_OUTBOUND_RULES,
      actor,
    );
    const record = await this.client.upsert({
      where: { id: DEFAULT_CONFIG_ID },
      create: {
        id: DEFAULT_CONFIG_ID,
        globalVariables: toPrismaJson(dto.globalVariables ?? DEFAULT_GLOBAL_VARIABLES),
        apiPlugins: toPrismaJson(dto.apiPlugins ?? DEFAULT_API_PLUGINS),
        outboundRules: toPrismaJson(createOutboundRules),
      },
      update: data,
    });
    return this.toDomain(record);
  }

  async mergeDefaultVariables(
    variables: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    const config = await this.get();
    const defaults: Record<string, string> = {};
    for (const item of config.globalVariables) {
      if (!item.key || item.defaultValue === undefined) continue;
      defaults[item.key] = String(item.defaultValue);
    }
    return { ...defaults, ...variables };
  }

  async findApiPlugin(idOrName: string): Promise<GlobalApiPluginConfig | undefined> {
    const key = idOrName.trim();
    if (!key) return undefined;
    const config = await this.get();
    return config.apiPlugins.find((plugin) => {
      if (!plugin.enabled) return false;
      return plugin.id === key || plugin.name === key;
    });
  }

  async evaluateOutboundPolicy(input: {
    to: string;
    at?: Date;
    dailyCallCount?: number;
  }): Promise<OutboundPolicyDecision> {
    const config = await this.get();
    const rules = config.outboundRules;
    const at = input.at ?? new Date();
    const normalizedTo = normalizePhoneForPolicy(input.to);
    const whitelisted = rules.globalWhitelist.some((entry) =>
      normalizePhoneForPolicy(entry.phoneNumber) === normalizedTo,
    );

    if (
      !whitelisted &&
      rules.blockedNumbers.some((entry) =>
        normalizePhoneForPolicy(entry.phoneNumber) === normalizedTo,
      )
    ) {
      return {
        allowed: false,
        code: 'blocked_number',
        message: `号码 ${input.to} 命中全局黑名单`,
        details: { to: input.to },
      };
    }

    const callWindowDecision = evaluateCallWindow(rules.callWindow, at);
    if (!callWindowDecision.allowed) return callWindowDecision;

    if (rules.callWindow.nonHolidayOnly && isConfiguredHoliday(at)) {
      return {
        allowed: false,
        code: 'holiday_blocked',
        message: `当前日期 ${formatLocalDate(at)} 配置为不可外呼日期`,
        details: { date: formatLocalDate(at) },
      };
    }

    if (
      !whitelisted &&
      input.dailyCallCount !== undefined &&
      input.dailyCallCount >= rules.dailyCallLimitPerCallee
    ) {
      return {
        allowed: false,
        code: 'daily_limit_reached',
        message: `号码 ${input.to} 已达到当天 ${rules.dailyCallLimitPerCallee} 次外呼上限`,
        details: {
          to: input.to,
          dailyCallCount: input.dailyCallCount,
          dailyCallLimit: rules.dailyCallLimitPerCallee,
        },
      };
    }

    return { allowed: true };
  }

  private get client() {
    return (this.prisma as any).globalConfig;
  }

  private toDomain(record: GlobalConfigRecord): GlobalConfig {
    return {
      id: record.id,
      globalVariables: Array.isArray(record.globalVariables)
        ? record.globalVariables as GlobalVariableConfig[]
        : [],
      apiPlugins: Array.isArray(record.apiPlugins)
        ? record.apiPlugins as GlobalApiPluginConfig[]
        : [],
      outboundRules: this.normalizeOutboundRules(record.outboundRules, auditActorFromUser()),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private normalizeOutboundRules(value: unknown, actor: AuditActor): GlobalOutboundRulesConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...DEFAULT_OUTBOUND_RULES, callWindow: { ...DEFAULT_OUTBOUND_RULES.callWindow } };
    }

    const rules = value as Partial<GlobalOutboundRulesConfig>;
    const callWindow = rules.callWindow ?? DEFAULT_OUTBOUND_RULES.callWindow;
    return {
      callWindow: {
        startTime: callWindow.startTime ?? DEFAULT_OUTBOUND_RULES.callWindow.startTime,
        endTime: callWindow.endTime ?? DEFAULT_OUTBOUND_RULES.callWindow.endTime,
        weekdaysOnly: callWindow.weekdaysOnly ?? DEFAULT_OUTBOUND_RULES.callWindow.weekdaysOnly,
        nonHolidayOnly: callWindow.nonHolidayOnly ?? DEFAULT_OUTBOUND_RULES.callWindow.nonHolidayOnly,
      },
      dailyCallLimitPerCallee:
        typeof rules.dailyCallLimitPerCallee === 'number'
          ? Math.max(1, Math.min(99, Math.trunc(rules.dailyCallLimitPerCallee)))
          : DEFAULT_OUTBOUND_RULES.dailyCallLimitPerCallee,
      blockedNumbers: this.normalizeNumberList(rules.blockedNumbers, actor),
      globalWhitelist: this.normalizeNumberList(rules.globalWhitelist, actor),
      aiDisclosureTemplate:
        typeof rules.aiDisclosureTemplate === 'string' && rules.aiDisclosureTemplate.trim()
          ? rules.aiDisclosureTemplate.trim()
          : DEFAULT_OUTBOUND_RULES.aiDisclosureTemplate,
      maxAttemptsPerNumber:
        typeof rules.maxAttemptsPerNumber === 'number'
          ? Math.max(1, Math.min(99, Math.trunc(rules.maxAttemptsPerNumber)))
          : DEFAULT_OUTBOUND_RULES.maxAttemptsPerNumber,
    };
  }

  private normalizeNumberList(value: unknown, actor: AuditActor): GlobalOutboundNumberListEntry[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const result: GlobalOutboundNumberListEntry[] = [];
    for (const item of value) {
      const entry = this.normalizeNumberListEntry(item, actor);
      if (!entry || seen.has(entry.phoneNumber)) continue;
      seen.add(entry.phoneNumber);
      result.push(entry);
    }
    return result;
  }

  private normalizeNumberListEntry(
    value: unknown,
    actor: AuditActor,
  ): GlobalOutboundNumberListEntry | undefined {
    if (typeof value === 'string') {
      const phoneNumber = value.trim();
      return phoneNumber
        ? withCreateAuditFields<GlobalOutboundNumberListEntry>({ phoneNumber }, actor)
        : undefined;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const entry = value as Partial<GlobalOutboundNumberListEntry> & { createdBy?: unknown };
    const phoneNumber = typeof entry.phoneNumber === 'string' ? entry.phoneNumber.trim() : '';
    if (!phoneNumber) return undefined;

    const normalized = {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : undefined,
      phoneNumber,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt.trim() || undefined : undefined,
      createdByUserId:
        typeof entry.createdByUserId === 'string'
          ? entry.createdByUserId.trim() || undefined
          : undefined,
      createdByName:
        typeof entry.createdByName === 'string'
          ? entry.createdByName.trim() || undefined
          : typeof entry.createdBy === 'string'
            ? entry.createdBy.trim() || undefined
            : undefined,
      remark: typeof entry.remark === 'string' ? entry.remark.trim() || undefined : undefined,
    };
    return withCreateAuditFields<GlobalOutboundNumberListEntry>(normalized, actor);
  }
}

function normalizePhoneForPolicy(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

function evaluateCallWindow(
  callWindow: GlobalOutboundRulesConfig['callWindow'],
  at: Date,
): OutboundPolicyDecision {
  if (callWindow.weekdaysOnly) {
    const day = at.getDay();
    if (day === 0 || day === 6) {
      return {
        allowed: false,
        code: 'outside_call_window',
        message: `当前日期 ${formatLocalDate(at)} 不在工作日外呼范围内`,
        details: { date: formatLocalDate(at), weekdaysOnly: true },
      };
    }
  }

  const start = parseTimeToMinutes(callWindow.startTime);
  const end = parseTimeToMinutes(callWindow.endTime);
  if (start === undefined || end === undefined || start === end) return { allowed: true };

  const current = at.getHours() * 60 + at.getMinutes();
  const inWindow = start < end
    ? current >= start && current <= end
    : current >= start || current <= end;
  if (inWindow) return { allowed: true };

  return {
    allowed: false,
    code: 'outside_call_window',
    message: `当前时间 ${formatLocalTime(at)} 不在外呼时间窗 ${callWindow.startTime}-${callWindow.endTime} 内`,
    details: {
      time: formatLocalTime(at),
      startTime: callWindow.startTime,
      endTime: callWindow.endTime,
    },
  };
}

function parseTimeToMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function isConfiguredHoliday(at: Date): boolean {
  const holidays = (process.env.OUTBOUND_HOLIDAYS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return holidays.includes(formatLocalDate(at));
}

function formatLocalDate(at: Date): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTime(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
