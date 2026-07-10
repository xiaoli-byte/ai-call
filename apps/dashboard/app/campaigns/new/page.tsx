'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, CircleHelp, Download, Settings2 } from 'lucide-react';
import { FlowStatus, ScenarioStatus, TaskPriority, type TaskFlow } from '@ai-call/shared';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/client';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { useScenarios } from '@/hooks/use-scenarios';
import { appToast } from '@/lib/toast';
import {
  buildTemplate,
  normalizeDateTime,
  parseImportText,
  toDateTimeLocal,
} from '@/lib/outbound/import-parser';
import { LeadImportCard } from './_components/lead-import-card';
import styles from './new-campaign.module.scss';

const NAME_MAX_LENGTH = 50;

export default function NewCampaignPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [scenarioKey, setScenarioKey] = useState('');
  const [flowId, setFlowId] = useState('');
  const [listText, setListText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [scheduledAt, setScheduledAt] = useState('');
  const [concurrencyLimit, setConcurrencyLimit] = useState(3);
  const [maxAttempts, setMaxAttempts] = useState(2);

  const { data: scenariosData } = useScenarios();
  const { data: flowsData } = useTaskFlows(FlowStatus.PUBLISHED);

  const scenarios = (scenariosData ?? []).filter((item) => item.status !== ScenarioStatus.INACTIVE);
  const flows: TaskFlow[] = flowsData ?? [];
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

  async function handleFileSelected(file: File) {
    setFileName(file.name);
    setFileSize(file.size);
    setListText(await file.text());
  }

  function handleListTextChange(next: string, options?: { keepFileName?: boolean }) {
    setListText(next);
    if (options?.keepFileName === false) {
      setFileName('');
      setFileSize(0);
    }
  }

  function handleDownloadTemplate() {
    const blob = new Blob([buildTemplate()], { type: 'text/csv;charset=utf-8' });
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
            <p className="subtitle">配置活动信息、导入客户名单并设置执行策略，快速发起外呼任务</p>
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
              <div className="card-title">活动设置</div>
              <div className="card-subtitle">配置活动名称、场景、并发与执行时间</div>
            </div>
            <Settings2 size={18} />
          </div>

          <div className="form-group">
            <label className="form-label">
              活动名称
              <em className={styles.required}>*</em>
            </label>
            <div className={styles.inputCounter}>
              <input
                className="form-input"
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, NAME_MAX_LENGTH))}
                placeholder="例如：七月试驾邀约"
                maxLength={NAME_MAX_LENGTH}
              />
              <span className={styles.counter}>
                {name.length}/{NAME_MAX_LENGTH}
              </span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              业务场景
              <em className={styles.required}>*</em>
            </label>
            <select
              className="form-select"
              value={scenarioKey}
              onChange={(event) => handleScenarioChange(event.target.value)}
              required
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id ?? scenario.scenario} value={scenario.scenario}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">
              执行流程
              <CircleHelp size={12} className={styles.labelHint} aria-label="说明" />
            </label>
            <select className="form-select" value={flowId} onChange={(event) => setFlowId(event.target.value)}>
              <option value="">使用场景默认对话</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}（已发布 v{flow.version}）
                </option>
              ))}
            </select>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>活动并发设置</div>
            <div className={styles.subGrid}>
              <div className="form-group">
                <label className="form-label">
                  活动并发
                  <em className={styles.required}>*</em>
                </label>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={100}
                  value={concurrencyLimit}
                  onChange={(event) => setConcurrencyLimit(Number(event.target.value))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  最大拨打次数
                  <em className={styles.required}>*</em>
                </label>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(event) => setMaxAttempts(Number(event.target.value))}
                />
              </div>
            </div>
            <div className="form-hint">未接或失败后的重拨策略会在活动详情里追踪。</div>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>活动开始设置</div>
            <div className="form-group">
              <label className="form-label">
                计划开始时间
                <em className={styles.required}>*</em>
              </label>
              <div className={styles.dateField}>
                <input
                  type="datetime-local"
                  className="form-input"
                  min={toDateTimeLocal(new Date())}
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
                <CalendarDays size={14} className={styles.dateIcon} />
              </div>
            </div>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>预计任务效果</div>
            <div className={styles.summary}>
              <div>
                <span>{validRows.length}</span>
                <p>有效名单</p>
              </div>
              <div>
                <span>{invalidRows.length}</span>
                <p>异常行</p>
              </div>
              <div>
                <span>{concurrencyLimit}</span>
                <p>并发上限</p>
              </div>
            </div>
          </div>
        </section>

        <div className={styles.rightColumn}>
          <LeadImportCard
            listText={listText}
            fileName={fileName}
            fileSize={fileSize}
            onFileChange={handleFileSelected}
            onListTextChange={handleListTextChange}
          />

          <div className={styles.formActions}>
            <Link href="/campaigns" className="btn btn-ghost">
              取消
            </Link>
            <button
              type="submit"
              className="btn"
              disabled={submitting || validRows.length === 0 || !name.trim()}
            >
              {submitting ? '创建中...' : '创建活动并生成任务'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
