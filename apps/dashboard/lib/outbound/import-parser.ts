import {
  DEFAULT_GLOBAL_VARIABLES,
  TaskPriority,
  type GlobalConfig,
  type GlobalVariableConfig,
} from '@ai-call/shared';

export type ImportRow = {
  rowNumber: number;
  to: string;
  name?: string;
  scheduledAt?: string;
  scheduledAtIso?: string;
  priority?: TaskPriority;
  variables: Record<string, string>;
  errors: string[];
};

const PHONE_HEADERS = new Set(['phone', 'to', 'mobile', 'number', '手机号', '被叫号码', '号码', '电话']);
const NAME_HEADERS = new Set(['name', 'customer', 'customername', '客户姓名', '姓名']);
const SCHEDULE_HEADERS = new Set(['scheduledat', 'scheduled_at', 'calltime', '执行时间', '计划时间', '预约时间']);
const PRIORITY_HEADERS = new Set(['priority', '任务优先级', '优先级']);
const DESTINATION_PATTERN = /^\+?\d{3,15}$/;

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.HIGH]: '高',
  [TaskPriority.NORMAL]: '普通',
  [TaskPriority.LOW]: '低',
};

export function defaultVariableFields(globalConfig?: GlobalConfig | null): GlobalVariableConfig[] {
  if (globalConfig) return globalConfig.globalVariables ?? [];
  return DEFAULT_GLOBAL_VARIABLES;
}

export function toDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeHeader(value: string) {
  return value.trim().replace(/^\ufeff/, '').toLowerCase();
}

function normalizePriority(value: string | undefined): TaskPriority | undefined {
  const key = value?.trim().toLowerCase();
  if (!key) return undefined;
  if (['high', 'urgent', '紧急', '高'].includes(key)) return TaskPriority.HIGH;
  if (['low', '低'].includes(key)) return TaskPriority.LOW;
  return TaskPriority.NORMAL;
}

export function normalizeDateTime(value: string | undefined): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  const normalized = input.includes('T') ? input : input.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function parseLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseImportText(text: string): ImportRow[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseLine(lines[0], delimiter);
  const normalizedHeaders = headers.map(normalizeHeader);
  const phoneIndex = normalizedHeaders.findIndex((header) => PHONE_HEADERS.has(header));

  if (phoneIndex === -1) {
    return [{
      rowNumber: 1,
      to: '',
      variables: {},
      errors: ['缺少 phone/to/手机号 列'],
    }];
  }

  return lines.slice(1).map((line, index) => {
    const cells = parseLine(line, delimiter);
    const variables: Record<string, string> = {};
    const errors: string[] = [];
    let name: string | undefined;
    let scheduledAt: string | undefined;
    let scheduledAtIso: string | undefined;
    let priority: TaskPriority | undefined;

    const to = (cells[phoneIndex] ?? '').replace(/\s+/g, '');
    if (!DESTINATION_PATTERN.test(to)) errors.push('号码格式不正确');

    for (const [columnIndex, rawHeader] of headers.entries()) {
      const header = normalizeHeader(rawHeader);
      const value = (cells[columnIndex] ?? '').trim();
      if (!rawHeader.trim() || !value || PHONE_HEADERS.has(header)) continue;

      if (NAME_HEADERS.has(header)) {
        name = value;
        variables.customerName = value;
        continue;
      }
      if (SCHEDULE_HEADERS.has(header)) {
        scheduledAt = value;
        scheduledAtIso = normalizeDateTime(value);
        if (!scheduledAtIso) errors.push('执行时间无法识别');
        continue;
      }
      if (PRIORITY_HEADERS.has(header)) {
        priority = normalizePriority(value);
        continue;
      }

      variables[rawHeader.trim()] = value;
    }

    return {
      rowNumber: index + 2,
      to,
      name,
      scheduledAt,
      scheduledAtIso,
      priority,
      variables,
      errors,
    };
  });
}

const VARIABLE_KEY_HEADERS = new Set([
  ...PHONE_HEADERS,
  ...NAME_HEADERS,
  ...SCHEDULE_HEADERS,
  ...PRIORITY_HEADERS,
]);

function getCellValueForHeader(row: ImportRow, header: string): string {
  const trimmed = header.trim();
  if (!trimmed) return '';
  const lower = normalizeHeader(trimmed);
  if (PHONE_HEADERS.has(lower)) return row.to;
  if (NAME_HEADERS.has(lower)) return row.name ?? '';
  if (SCHEDULE_HEADERS.has(lower)) return row.scheduledAt ?? '';
  if (PRIORITY_HEADERS.has(lower)) {
    const value = row.priority ?? TaskPriority.NORMAL;
    return PRIORITY_LABELS[value];
  }
  return row.variables[trimmed] ?? '';
}

function escapeCell(value: string, delimiter: string): string {
  if (!value) return '';
  const needsQuoting =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r');
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeImportRows(headers: string[], rows: ImportRow[], delimiter = ','): string {
  const cleanHeaders = headers.map((header) => header.trim()).filter((header) => header.length > 0);
  const headerLine = cleanHeaders.map((header) => escapeCell(header, delimiter)).join(delimiter);
  const dataLines = rows.map((row) => {
    return cleanHeaders.map((header) => escapeCell(getCellValueForHeader(row, header), delimiter)).join(delimiter);
  });
  return [headerLine, ...dataLines].join('\n') + (dataLines.length > 0 ? '\n' : '');
}

export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')[0] ?? '';
  return firstLine.includes('\t') ? '\t' : ',';
}

export function extractHeaders(text: string, delimiter: string): string[] {
  const firstLine = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .find((line) => line.trim().length > 0);
  if (!firstLine) return [];
  return parseLine(firstLine, delimiter);
}

export function getSystemColumnKeys(): string[] {
  return ['phone', 'name', 'scheduledAt', 'priority'];
}

export function isSystemColumn(header: string): boolean {
  return VARIABLE_KEY_HEADERS.has(normalizeHeader(header));
}

export function buildTemplate(variableKeys = ['company']) {
  const headers = ['phone', 'name', ...variableKeys];
  const example = headers.map((header) => {
    if (header === 'phone') return '1001';
    if (header === 'name') return '张三';
    if (header === 'company') return '示例公司';
    if (header === 'product') return '试驾邀约';
    if (header === 'orderNo') return 'DEMO20260704001';
    if (header === 'activity') return '夏日试驾季';
    return '';
  });
  return `\ufeff${headers.join(',')}\n${example.join(',')}\n`;
}

/**
 * 自动检测文件编码并读取为文本。
 * 检测顺序:UTF-8 BOM / UTF-16 LE BOM / UTF-16 BE BOM → UTF-8(无替换字符)→ GBK 回退。
 * 解决 WPS 中文版默认 GBK 保存 CSV 导致的中文乱码问题。
 */
export async function readFileAsText(file: Blob): Promise<string> {
  if (typeof file.arrayBuffer !== 'function') {
    return file.text();
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  const utf8Text = new TextDecoder('utf-8').decode(bytes);
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text;
  }
  try {
    return new TextDecoder('gbk').decode(bytes);
  } catch {
    return utf8Text;
  }
}
