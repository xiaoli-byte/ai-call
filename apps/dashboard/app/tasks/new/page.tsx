'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  UploadCloud,
} from 'lucide-react';
import {
  DEFAULT_GLOBAL_VARIABLES,
  FlowStatus,
  ScenarioStatus,
  TaskPriority,
  type TaskFlow,
} from '@ai-call/shared';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { useTaskMutations } from '@/hooks/use-tasks';
import { useScenarios } from '@/hooks/use-scenarios';
import { useGlobalConfig } from '@/hooks/use-global-config';
import { appToast } from '@/lib/toast';

type ImportRow = {
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

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.HIGH]: '高',
  [TaskPriority.NORMAL]: '普通',
  [TaskPriority.LOW]: '低',
};

function defaultVariableFields(globalConfig: ReturnType<typeof useGlobalConfig>['data']) {
  if (globalConfig) return globalConfig.globalVariables ?? [];
  return DEFAULT_GLOBAL_VARIABLES;
}

function toDateTimeLocal(date: Date) {
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

function normalizeDateTime(value: string | undefined): string | undefined {
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

function parseImportText(text: string): ImportRow[] {
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

function buildTemplate(variableKeys: string[]) {
  const headers = ['phone', 'name', 'scheduledAt', 'priority', ...variableKeys];
  const example = headers.map((header) => {
    if (header === 'phone') return '1001';
    if (header === 'name') return '张三';
    if (header === 'scheduledAt') return '2026-07-04 20:00';
    if (header === 'priority') return 'high';
    if (header === 'company') return '示例公司';
    if (header === 'product') return '试驾邀约';
    if (header === 'orderNo') return 'DEMO20260704001';
    if (header === 'activity') return '夏日试驾季';
    return '';
  });
  return `\ufeff${headers.join(',')}\n${example.join(',')}\n`;
}

export default function NewTaskPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [scenarioKey, setScenarioKey] = useState<string>('');
  const [flowId, setFlowId] = useState<string>('');
  const [listText, setListText] = useState('');
  const [fileName, setFileName] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.NORMAL);

  const { data: scenariosData } = useScenarios();
  const { data: globalConfig } = useGlobalConfig();
  const { data: flowsData } = useTaskFlows(FlowStatus.PUBLISHED);
  const { createBatch } = useTaskMutations();

  const scenarios = (scenariosData ?? []).filter((item) => item.status !== ScenarioStatus.INACTIVE);
  const flows: TaskFlow[] = flowsData ?? [];
  const variableFields = defaultVariableFields(globalConfig);
  const templateVariableKeys = variableFields
    .map((field) => field.key)
    .filter((key) => key && !['customerName', 'taskPriority'].includes(key));

  const rows = useMemo(() => parseImportText(listText), [listText]);
  const validRows = rows.filter((row) => row.errors.length === 0);
  const invalidRows = rows.filter((row) => row.errors.length > 0);
  const variableColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of validRows) {
      Object.keys(row.variables).forEach((key) => keys.add(key));
    }
    return [...keys];
  }, [validRows]);

  const selectedScenario = useMemo(
    () => scenarios.find((item) => item.scenario === scenarioKey),
    [scenarios, scenarioKey],
  );

  useEffect(() => {
    if (scenarioKey || scenarios.length === 0) return;
    const first = scenarios[0];
    setScenarioKey(first.scenario);
    setFlowId(first.defaultFlowId ?? '');
  }, [scenarioKey, scenarios]);

  function handleScenarioChange(next: string) {
    const scenario = scenarios.find((item) => item.scenario === next);
    setScenarioKey(next);
    setFlowId(scenario?.defaultFlowId ?? '');
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setListText(await file.text());
  }

  function handleDownloadTemplate() {
    const blob = new Blob([buildTemplate(templateVariableKeys)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'outbound-call-list-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validRows.length === 0) {
      appToast.error('请先导入有效名单');
      return;
    }
    if (!selectedScenario && !scenarioKey) {
      appToast.error('请选择业务场景');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createBatch({
        scenario: selectedScenario?.scenario ?? scenarioKey,
        scenarioId: selectedScenario?.id,
        flowId: flowId || undefined,
        scheduledAt: normalizeDateTime(scheduledAt),
        priority,
        items: validRows.map((row) => ({
          to: row.to,
          scheduledAt: row.scheduledAtIso,
          priority: row.priority,
          variables: row.variables,
        })),
      });
      appToast.success(`已创建 ${result.createdCount} 个外呼任务`);
      router.push('/tasks');
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  const defaultScheduleLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleString('zh-CN', { hour12: false })
    : '立即入队';

  return (
    <div className="task-import-page">
      <div className="page-header">
        <div className="page-header-content">
          <button type="button" className="task-import-back" onClick={() => router.back()} aria-label="返回">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="page-title">创建外呼任务</h1>
            <p className="subtitle">用名单文件一次生成多通外呼，行内变量会随任务一起下发。</p>
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
            <Download size={15} />
            下载模板
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="task-import-layout">
        <section className="card task-import-settings">
          <div className="card-header">
            <div>
              <div className="card-title">任务策略</div>
              <div className="card-subtitle">场景、流程、时间和优先级</div>
            </div>
            <ClipboardList size={18} />
          </div>

          <div className="form-group">
            <label className="form-label">业务场景 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <select
              className="form-select"
              value={scenarioKey}
              onChange={(event) => handleScenarioChange(event.target.value)}
              disabled={scenarios.length === 0}
              required
            >
              {scenarios.length === 0 ? (
                <option value="">暂无可用场景</option>
              ) : (
                scenarios.map((scenario) => (
                  <option key={scenario.id ?? scenario.scenario} value={scenario.scenario}>
                    {scenario.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">执行流程</label>
            <select
              className="form-select"
              value={flowId}
              onChange={(event) => setFlowId(event.target.value)}
            >
              <option value="">使用场景默认对话</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}（已发布 v{flow.version}）
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-2">
            <div className="form-group">
              <label className="form-label">执行时间</label>
              <input
                type="datetime-local"
                className="form-input"
                min={toDateTimeLocal(new Date())}
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
              <div className="form-hint">名单内的执行时间会覆盖这里。</div>
            </div>

            <div className="form-group">
              <label className="form-label">任务优先级</label>
              <select
                className="form-select"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
              >
                <option value={TaskPriority.HIGH}>高</option>
                <option value={TaskPriority.NORMAL}>普通</option>
                <option value={TaskPriority.LOW}>低</option>
              </select>
              <div className="form-hint">名单内的优先级会覆盖这里。</div>
            </div>
          </div>

          <div className="task-import-summary">
            <div>
              <span>{validRows.length}</span>
              <p>有效号码</p>
            </div>
            <div>
              <span>{invalidRows.length}</span>
              <p>异常行</p>
            </div>
            <div>
              <span>{variableColumns.length}</span>
              <p>变量列</p>
            </div>
          </div>
        </section>

        <section className="card task-import-list">
          <div className="card-header">
            <div>
              <div className="card-title">外呼名单</div>
              <div className="card-subtitle">
                {fileName || `默认时间：${defaultScheduleLabel}，默认优先级：${PRIORITY_LABELS[priority]}`}
              </div>
            </div>
            <FileSpreadsheet size={18} />
          </div>

          <label className="task-import-upload">
            <UploadCloud size={22} />
            <span>{fileName ? fileName : '上传 CSV / TSV 名单'}</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              onChange={handleFileChange}
            />
          </label>

          <div className="form-group">
            <label className="form-label">名单内容</label>
            <textarea
              className="form-textarea form-mono task-import-textarea"
              value={listText}
              onChange={(event) => {
                setFileName('');
                setListText(event.target.value);
              }}
              placeholder={'phone,name,scheduledAt,priority,company,product\n1001,张三,2026-07-04 20:00,high,示例公司,试驾邀约'}
            />
          </div>

          {invalidRows.length > 0 && (
            <div className="task-import-alert">
              <AlertTriangle size={16} />
              <span>
                {invalidRows.slice(0, 3).map((row) => `第 ${row.rowNumber} 行：${row.errors.join('、')}`).join('；')}
                {invalidRows.length > 3 ? `；另有 ${invalidRows.length - 3} 行异常` : ''}
              </span>
            </div>
          )}

          {validRows.length > 0 ? (
            <div className="task-import-preview table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>号码</th>
                    <th>客户</th>
                    <th>执行时间</th>
                    <th>优先级</th>
                    <th>变量</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 8).map((row) => (
                    <tr key={`${row.rowNumber}-${row.to}`}>
                      <td style={{ fontWeight: 600 }}>{row.to}</td>
                      <td>{row.name || row.variables.customerName || '未填写'}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {row.scheduledAt || defaultScheduleLabel}
                      </td>
                      <td>
                        <span className={`badge ${row.priority === TaskPriority.HIGH ? 'badge-warning' : row.priority === TaskPriority.LOW ? 'badge-neutral' : 'badge-primary'}`}>
                          {PRIORITY_LABELS[row.priority ?? priority]}
                        </span>
                      </td>
                      <td>
                        <div className="tag-list">
                          {Object.entries(row.variables).slice(0, 3).map(([key, value]) => (
                            <span key={key} className="badge badge-neutral">{key}: {value}</span>
                          ))}
                          {Object.keys(row.variables).length > 3 && (
                            <span className="badge badge-neutral">+{Object.keys(row.variables).length - 3}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validRows.length > 8 && (
                <div className="task-import-more">已隐藏 {validRows.length - 8} 行预览</div>
              )}
            </div>
          ) : (
            <div className="task-import-empty">
              <CheckCircle2 size={18} />
              <span>等待导入名单</span>
            </div>
          )}

          <div className="row-actions task-import-actions">
            <button
              type="submit"
              className="btn"
              disabled={submitting || scenarios.length === 0 || validRows.length === 0}
            >
              {submitting ? '创建中...' : `创建 ${validRows.length} 个任务`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
              取消
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}
