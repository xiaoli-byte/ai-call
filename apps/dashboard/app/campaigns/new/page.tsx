'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ClipboardList, Download, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { FlowStatus, ScenarioStatus, TaskPriority, type TaskFlow } from '@ai-call/shared';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/client';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { useScenarios } from '@/hooks/use-scenarios';
import { useGlobalConfig } from '@/hooks/use-global-config';
import { appToast } from '@/lib/toast';
import {
  buildTemplate,
  defaultVariableFields,
  normalizeDateTime,
  parseImportText,
  PRIORITY_LABELS,
  toDateTimeLocal,
} from '../../tasks/new/import-parser';
import styles from '../../tasks/new/new-task.module.scss';

export default function NewCampaignPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [scenarioKey, setScenarioKey] = useState('');
  const [flowId, setFlowId] = useState('');
  const [listText, setListText] = useState('');
  const [fileName, setFileName] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [concurrencyLimit, setConcurrencyLimit] = useState(3);
  const [maxAttempts, setMaxAttempts] = useState(2);

  const { data: scenariosData } = useScenarios();
  const { data: globalConfig } = useGlobalConfig();
  const { data: flowsData } = useTaskFlows(FlowStatus.PUBLISHED);

  const scenarios = (scenariosData ?? []).filter((item) => item.status !== ScenarioStatus.INACTIVE);
  const flows: TaskFlow[] = flowsData ?? [];
  const variableFields = defaultVariableFields(globalConfig);
  const rows = useMemo(() => parseImportText(listText), [listText]);
  const validRows = rows.filter((row) => row.errors.length === 0);
  const invalidRows = rows.filter((row) => row.errors.length > 0);
  const selectedScenario = scenarios.find((item) => item.scenario === scenarioKey);

  useEffect(() => {
    if (scenarioKey || scenarios.length === 0) return;
    const first = scenarios[0];
    setScenarioKey(first.scenario);
    setFlowId(first.defaultFlowId ?? '');
    setName(`${first.name}外呼活动`);
  }, [scenarioKey, scenarios]);

  function handleScenarioChange(next: string) {
    const scenario = scenarios.find((item) => item.scenario === next);
    setScenarioKey(next);
    setFlowId(scenario?.defaultFlowId ?? '');
    if (scenario && !name.trim()) setName(`${scenario.name}外呼活动`);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setListText(await file.text());
  }

  function handleDownloadTemplate() {
    const keys = variableFields.map((field) => field.key).filter(Boolean);
    const blob = new Blob([buildTemplate(keys)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'campaign-leads-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      appToast.error('请输入活动名称');
      return;
    }
    if (!selectedScenario && !scenarioKey) {
      appToast.error('请选择业务场景');
      return;
    }
    if (validRows.length === 0) {
      appToast.error('请先导入有效名单');
      return;
    }
    setSubmitting(true);
    try {
      const campaign = await apiClient.campaigns.create({
        name: name.trim(),
        scenario: selectedScenario?.scenario ?? scenarioKey,
        scenarioId: selectedScenario?.id,
        flowId: flowId || undefined,
        scheduledAt: normalizeDateTime(scheduledAt),
        concurrencyLimit,
        retryPolicy: { maxAttempts },
        leads: validRows.map((row) => ({
          phoneNumber: row.to,
          name: row.name || row.variables.customerName,
          scheduledAt: row.scheduledAtIso,
          priority: row.priority ?? TaskPriority.NORMAL,
          variables: row.variables,
        })),
      });
      appToast.success(`活动已创建，生成 ${campaign.stats.scheduledTasks} 个外呼任务`);
      router.push(`/campaigns/${campaign.id}`);
    } catch (err) {
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div className={styles.headerContent}>
          <Link href="/campaigns" className={styles.back} aria-label="返回活动列表">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="page-title">新建外呼活动</h1>
            <p className="subtitle">用活动维度管理名单、排期、并发和重拨策略。</p>
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
            <Download size={15} />
            下载模板
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className={styles.layout}>
        <section className={cn('card', styles.settings)}>
          <div className="card-header">
            <div>
              <div className="card-title">活动策略</div>
              <div className="card-subtitle">活动目标、流程和拨打约束</div>
            </div>
            <ClipboardList size={18} />
          </div>

          <div className="form-group">
            <label className="form-label">活动名称</label>
            <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：七月试驾邀约" />
          </div>

          <div className="form-group">
            <label className="form-label">业务场景</label>
            <select className="form-select" value={scenarioKey} onChange={(event) => handleScenarioChange(event.target.value)} required>
              {scenarios.map((scenario) => (
                <option key={scenario.id ?? scenario.scenario} value={scenario.scenario}>{scenario.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">执行流程</label>
            <select className="form-select" value={flowId} onChange={(event) => setFlowId(event.target.value)}>
              <option value="">使用场景默认对话</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>{flow.name}（已发布 v{flow.version}）</option>
              ))}
            </select>
          </div>

          <div className="grid grid-2">
            <div className="form-group">
              <label className="form-label">计划开始</label>
              <input
                type="datetime-local"
                className="form-input"
                min={toDateTimeLocal(new Date())}
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">活动并发</label>
              <input type="number" className="form-input" min={1} max={100} value={concurrencyLimit} onChange={(event) => setConcurrencyLimit(Number(event.target.value))} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">最大拨打次数</label>
            <input type="number" className="form-input" min={1} max={10} value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} />
            <div className="form-hint">未接或失败后的重拨策略会在活动详情里追踪。</div>
          </div>

          <div className={styles.summary}>
            <div><span>{validRows.length}</span><p>有效名单</p></div>
            <div><span>{invalidRows.length}</span><p>异常行</p></div>
            <div><span>{concurrencyLimit}</span><p>并发上限</p></div>
          </div>
        </section>

        <section className={cn('card', styles.list)}>
          <div className="card-header">
            <div>
              <div className="card-title">客户名单</div>
              <div className="card-subtitle">{fileName || '支持 CSV / TSV，表头兼容 phone/name/scheduledAt/priority'}</div>
            </div>
            <FileSpreadsheet size={18} />
          </div>

          <label className={styles.upload}>
            <UploadCloud size={22} />
            <span>{fileName || '上传名单文件'}</span>
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={handleFileChange} />
          </label>

          <textarea
            className={cn('form-textarea form-mono', styles.textarea)}
            value={listText}
            onChange={(event) => {
              setFileName('');
              setListText(event.target.value);
            }}
            placeholder={'phone,name,scheduledAt,priority,company,product\n1001,张三,2026-07-04 20:00,high,示例公司,试驾邀约'}
          />

          <div className={styles.preview}>
            <table>
              <thead><tr><th>号码</th><th>客户</th><th>时间</th><th>优先级</th><th>状态</th></tr></thead>
              <tbody>
                {rows.slice(0, 10).map((row) => (
                  <tr key={`${row.rowNumber}-${row.to}`}>
                    <td>{row.to || '-'}</td>
                    <td>{row.name || row.variables.customerName || '-'}</td>
                    <td>{row.scheduledAt || '默认'}</td>
                    <td>{PRIORITY_LABELS[row.priority ?? TaskPriority.NORMAL]}</td>
                    <td>{row.errors.length ? row.errors.join('、') : '可导入'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5}>等待导入名单</td></tr>}
              </tbody>
            </table>
          </div>

          <div className={cn('row-actions', styles.actions)}>
            <button type="submit" className="btn" disabled={submitting || validRows.length === 0 || !name.trim()}>
              {submitting ? '创建中...' : `创建活动并生成 ${validRows.length} 个任务`}
            </button>
            <Link href="/campaigns" className="btn btn-ghost">取消</Link>
          </div>
        </section>
      </form>
    </div>
  );
}
