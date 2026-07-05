export interface GlobalVariableConfig {
  key: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  description?: string;
}

export interface GlobalApiPluginConfig {
  id?: string;
  name: string;
  description?: string;
  enabled: boolean;
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: unknown;
  timeoutSeconds?: number;
}

export interface GlobalOutboundCallWindowConfig {
  startTime: string;
  endTime: string;
  weekdaysOnly: boolean;
  nonHolidayOnly: boolean;
}

export interface GlobalOutboundNumberListEntry {
  id?: string;
  phoneNumber: string;
  createdAt?: string;
  createdByUserId?: string;
  createdByName?: string;
  remark?: string;
}

export interface GlobalOutboundRulesConfig {
  callWindow: GlobalOutboundCallWindowConfig;
  dailyCallLimitPerCallee: number;
  blockedNumbers: GlobalOutboundNumberListEntry[];
  globalWhitelist: GlobalOutboundNumberListEntry[];
}

export const DEFAULT_GLOBAL_VARIABLES: GlobalVariableConfig[] = [
  { key: 'company', label: '公司名称', defaultValue: '示例公司', required: true },
  { key: 'product', label: '产品名称' },
  { key: 'amount', label: '应还金额' },
  { key: 'days', label: '逾期天数' },
  { key: 'orderNo', label: '订单号', defaultValue: 'DEMO20260627001' },
  { key: 'activity', label: '活动名称', defaultValue: '夏日试驾季' },
];

export const DEFAULT_API_PLUGINS: GlobalApiPluginConfig[] = [
  {
    id: 'query_repayment_info',
    name: '查询还款信息',
    enabled: true,
    method: 'POST',
    timeoutSeconds: 10,
  },
  {
    id: 'query_order',
    name: '查询订单',
    enabled: true,
    method: 'POST',
    timeoutSeconds: 10,
  },
  {
    id: 'create_after_sale_ticket',
    name: '创建售后工单',
    enabled: true,
    method: 'POST',
    timeoutSeconds: 10,
  },
  {
    id: 'create_test_drive_appointment',
    name: '创建试驾预约',
    enabled: true,
    method: 'POST',
    timeoutSeconds: 10,
  },
];

export const DEFAULT_OUTBOUND_RULES: GlobalOutboundRulesConfig = {
  callWindow: {
    startTime: '09:00',
    endTime: '18:00',
    weekdaysOnly: true,
    nonHolidayOnly: false,
  },
  dailyCallLimitPerCallee: 3,
  blockedNumbers: [],
  globalWhitelist: [],
};

export interface GlobalConfig {
  id: string;
  globalVariables: GlobalVariableConfig[];
  apiPlugins: GlobalApiPluginConfig[];
  outboundRules: GlobalOutboundRulesConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateGlobalConfigDto {
  globalVariables?: GlobalVariableConfig[];
  apiPlugins?: GlobalApiPluginConfig[];
  outboundRules?: GlobalOutboundRulesConfig;
}
