'use client';

import { useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { appToast } from '@/lib/toast';

import styles from '../../../tasks/tasks.module.scss';

export function ScenarioTestRunner({
  scenarioKey,
  flowOptions,
}: {
  scenarioKey: string;
  flowOptions: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('handoff');
  const [flowId, setFlowId] = useState(flowOptions[0]?.id ?? '');
  const [golden, setGolden] = useState(true);
  const [pending, setPending] = useState(false);

  async function run() {
    if (!input.trim()) {
      appToast.error('请输入模拟客户回答');
      return;
    }
    setPending(true);
    try {
      await apiClient.scenarioTests.run(scenarioKey, {
        input,
        flowId: flowId || undefined,
        expectedOutcome: expectedOutcome || undefined,
        golden,
      });
      appToast.success('测试已记录');
      setInput('');
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.tableShell} style={{ padding: 16 }}>
      <div className={styles.toolbar} style={{ minHeight: 0 }}>
        <div className={styles.tools} style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
          <select className="form-select" value={flowId} onChange={(event) => setFlowId(event.target.value)}>
            <option value="">仅测试场景话术</option>
            {flowOptions.map((flow) => (
              <option key={flow.id} value={flow.id}>{flow.name}</option>
            ))}
          </select>
          <select className="form-select" value={expectedOutcome} onChange={(event) => setExpectedOutcome(event.target.value)}>
            <option value="handoff">预期转人工</option>
            <option value="answer">预期回答</option>
            <option value="end">预期结束</option>
          </select>
          <label className="form-checkbox" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={golden} onChange={(event) => setGolden(event.target.checked)} />
            黄金测试
          </label>
        </div>
      </div>
      <textarea
        className="form-textarea"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        rows={4}
        placeholder="例如：我现在失业了，想申请延期还款"
      />
      <div className={styles.tools} style={{ marginTop: 10 }}>
        <button type="button" className={styles.primaryButton} onClick={run} disabled={pending}>
          <PlayCircle size={14} />
          {pending ? '运行中...' : '运行测试'}
        </button>
      </div>
    </section>
  );
}
