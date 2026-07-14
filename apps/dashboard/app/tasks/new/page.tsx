'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, CircleHelp, Download, Settings2 } from 'lucide-react';
import { FlowStatus, PERMISSIONS, ScenarioStatus, TaskPriority, type TaskFlow } from '@ai-call/shared';
import { extractFlowVariables } from '@ai-call/shared';
import { apiClient } from '@/lib/api/client';
import { useTaskFlows } from '@/hooks/use-task-flows';
import { useScenarios } from '@/hooks/use-scenarios';
import { usePermission } from '@/hooks/use-permission';
import { appToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  buildTemplate,
  normalizeDateTime,
  parseImportText,
  readFileAsText,
  toDateTimeLocal,
} from '@/lib/outbound/import-parser';
import { TaskImportCard } from './_components/task-import-card';
import styles from './new-task.module.scss';

export default function NewTaskPage() {
  const router = useRouter();
  const canCreateTask = usePermission(PERMISSIONS.TASK_CREATE);
  const [submitting, setSubmitting] = useState(false);
  const [scenarioKey, setScenarioKey] = useState('');
  const [flowId, setFlowId] = useState('');
  const [listText, setListText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [scheduledAt, setScheduledAt] = useState('');

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
  }, [scenarioKey, scenarios]);

  function handleScenarioChange(next: string) {
    const scenario = scenarios.find((item) => item.scenario === next);
    setScenarioKey(next);
    setFlowId(scenario?.defaultFlowId ?? '');
  }

  async function handleFileSelected(file: File) {
    setFileName(file.name);
    setFileSize(file.size);
    setListText(await readFileAsText(file));
  }

  function handleListTextChange(next: string, options?: { keepFileName?: boolean }) {
    setListText(next);
    if (options?.keepFileName === false) {
      setFileName('');
      setFileSize(0);
    }
  }

  function handleDownloadTemplate() {
    const flow = flows.find((item) => item.id === flowId);
    const dynamicKeys = extractFlowVariables(flow);
    const variableKeys = ['company', ...dynamicKeys];
    const blob = new Blob([buildTemplate(variableKeys)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'outbound-tasks-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedScenario && !scenarioKey) {
      appToast.error('请选择业务场景');
      return;
    }
    if (validRows.length === 0) {
      appToast.error('请先导入有效任务名单');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiClient.tasks.createBatch({
        scenario: selectedScenario?.scenario ?? scenarioKey,
        scenarioId: selectedScenario?.id,
        flowId: flowId || undefined,
        scheduledAt: normalizeDateTime(scheduledAt),
        items: validRows.map((row) => ({
          to: row.to,
          scheduledAt: row.scheduledAtIso,
          priority: row.priority ?? TaskPriority.NORMAL,
          variables: {
            ...row.variables,
            ...(row.name ? { customerName: row.name } : {}),
          },
        })),
      });
      appToast.success(`已创建 ${result.createdCount} 个外呼任务`);
      router.push('/tasks');
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div className={styles.headerContent}>
          <Link href="/tasks" className={styles.back} aria-label="返回任务列表">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="page-title">新建外呼任务</h1>
            <p className="subtitle">选择执行场景并导入客户名单，批量生成待拨打任务</p>
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
              <div className="card-title">任务设置</div>
              <div className="card-subtitle">配置场景、执行流程和统一拨打时间</div>
            </div>
            <Settings2 size={18} />
          </div>

          <div className="form-group">
            <label className="form-label">业务场景 <em className={styles.required}>*</em></label>
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
                <option key={flow.id} value={flow.id}>{flow.name}（已发布 v{flow.version}）</option>
              ))}
            </select>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>执行时间</div>
            <div className="form-group">
              <label className="form-label">统一计划拨打时间</label>
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
              <div className="form-hint">名单中单独设置的时间优先；留空则立即进入待执行队列。</div>
            </div>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>导入结果</div>
            <div className={styles.summary}>
              <div><span>{validRows.length}</span><p>有效任务</p></div>
              <div><span>{invalidRows.length}</span><p>异常行</p></div>
              <div><span>{rows.length}</span><p>导入总数</p></div>
            </div>
          </div>
        </section>

        <div className={styles.rightColumn}>
          <TaskImportCard
            listText={listText}
            fileName={fileName}
            fileSize={fileSize}
            onFileChange={handleFileSelected}
            onListTextChange={handleListTextChange}
          />

          <div className={styles.formActions}>
            <Link href="/tasks" className="btn btn-ghost">取消</Link>
            {canCreateTask && (
              <button type="submit" className="btn" disabled={submitting || validRows.length === 0}>
                {submitting ? '创建中...' : `创建 ${validRows.length} 个任务`}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
