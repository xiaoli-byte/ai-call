'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTaskFlowMutations } from '@/hooks/use-task-flows';
import { useScenarios } from '@/hooks/use-scenarios';
import { appToast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TemplateCard } from './_components/template-card';
import { ScenarioStatus, TASK_FLOW_TEMPLATES } from '@ai-call/shared';
import type { TaskFlowTemplate } from '@ai-call/shared';

import styles from './new-task-flow.module.scss';

export default function NewTaskFlowPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState('');
  const { data: scenariosData } = useScenarios();
  const scenarios = (scenariosData ?? []).filter((item) => item.status !== ScenarioStatus.INACTIVE);
  const { create } = useTaskFlowMutations();

  async function createFromTemplate(tpl: TaskFlowTemplate) {
    setSubmitting(tpl.id);
    try {
      const created = await create({
        name: tpl.name,
        description: tpl.description,
        scenarioId: scenarioId || undefined,
        nodes: tpl.nodes,
        edges: tpl.edges,
      });
      appToast.success('流程创建成功');
      router.push(`/task-flows/${created.id}`);
    } catch (err) {
      appToast.error(err);
      setSubmitting(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">新建外呼流程</h1>
          <p className="subtitle">选择模板快速创建，所有流程均含 Start 节点</p>
        </div>
        <div className="page-actions">
          <Link href="/task-flows" className="btn btn-secondary">
            <ArrowLeft size={13} />
            返回列表
          </Link>
        </div>
      </div>

      <div className={cn('card', styles.scenarioPanel)}>
        <div className="form-group">
          <label className="form-label">绑定场景配置</label>
          <select className="form-select" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
            <option value="">暂不绑定</option>
            {scenarios.map((scenario) => (
              <option key={scenario.id ?? scenario.scenario} value={scenario.id ?? ''} disabled={!scenario.id}>
                {scenario.name}（{scenario.scenario}）
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={cn('grid grid-2', styles.templateGrid)}>
        {TASK_FLOW_TEMPLATES.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            template={tpl}
            disabled={submitting !== null}
            loading={submitting === tpl.id}
            dimmed={Boolean(submitting && submitting !== tpl.id)}
            subtitle={tpl.id === 'blank' ? '空白画布' : '预设模板'}
            emptyLabel="空白画布"
            loadingLabel="创建中"
            ctaLabel="使用此模板"
            onSelect={() => createFromTemplate(tpl)}
          />
        ))}
      </div>
    </div>
  );
}
