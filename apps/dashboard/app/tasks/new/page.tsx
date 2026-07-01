'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlowStatus, Scenario, type TaskFlow } from '@ai-call/shared';
import { apiClient } from '@/lib/api';

const SCENARIO_LABELS: Record<Scenario, string> = {
  collection: '贷后催收',
  ecommerce: '电商售后',
  presale: '售前邀约',
};

const SCENARIO_DESC: Record<Scenario, string> = {
  collection: '还款提醒、逾期催收等场景',
  ecommerce: '订单查询、退换货、售后服务',
  presale: '4S 店试驾邀约、活动推广',
};

export default function NewTaskPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(Scenario.ECOMMERCE);
  const [flows, setFlows] = useState<TaskFlow[]>([]);

  useEffect(() => {
    apiClient.taskFlows.list(FlowStatus.PUBLISHED).then(setFlows).catch(() => setFlows([]));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const dto = {
      to: String(formData.get('to') ?? ''),
      scenario: String(formData.get('scenario') ?? 'ecommerce') as Scenario,
      flowId: String(formData.get('flowId') ?? '') || undefined,
      variables: {
        company: String(formData.get('company') ?? ''),
        orderNo: String(formData.get('orderNo') ?? ''),
        product: String(formData.get('product') ?? ''),
        activity: String(formData.get('activity') ?? ''),
      },
    };
    try {
      await apiClient.createTask(dto);
      router.push('/tasks');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">新建外呼任务</h1>
          <p className="subtitle">填写被叫号码和场景信息，提交后即可派发</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">被叫号码 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input
              name="to"
              className="form-input"
              required
              placeholder="+8613800138000"
              pattern="^\+?\d{6,15}$"
            />
            <div className="form-hint">支持 E.164 国际格式，例如 +8613800138000</div>
          </div>

          <div className="form-group">
            <label className="form-label">业务场景 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {(Object.keys(SCENARIO_LABELS) as Scenario[]).map((s) => (
                <label
                  key={s}
                  style={{
                    border: `1px solid ${scenario === s ? 'var(--primary-600)' : 'var(--border)'}`,
                    background: scenario === s ? 'var(--primary-50)' : 'var(--bg-elevated)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="scenario"
                    value={s}
                    checked={scenario === s}
                    onChange={(e) => setScenario(e.target.value as Scenario)}
                    style={{ display: 'none' }}
                  />
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text)' }}>
                    {SCENARIO_LABELS[s]}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 4 }}>
                    {SCENARIO_DESC[s]}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="divider" />

          <div className="form-group">
            <label className="form-label">执行流程</label>
            <select name="flowId" className="form-input" defaultValue="">
              <option value="">使用场景默认对话</option>
              {flows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}（已发布 v{flow.version}）
                </option>
              ))}
            </select>
            <div className="form-hint">任务创建后会锁定当前已发布版本，后续编辑不会影响本次通话。</div>
          </div>

          <div className="divider" />

          <div className="form-group">
            <label className="form-label">公司名称</label>
            <input name="company" className="form-input" placeholder="示例公司" />
          </div>

          <div className="form-group">
            <label className="form-label">订单号（电商场景）</label>
            <input name="orderNo" className="form-input" placeholder="DEMO20260627001" />
          </div>

          <div className="form-group">
            <label className="form-label">产品名称（催收场景）</label>
            <input name="product" className="form-input" placeholder="消费贷" />
          </div>

          <div className="form-group">
            <label className="form-label">活动名称（售前场景）</label>
            <input name="activity" className="form-input" placeholder="夏日试驾季" />
          </div>

          {error && (
            <div className="error-banner">{error}</div>
          )}

          <div className="row-actions" style={{ marginTop: 8 }}>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? '创建中...' : '创建任务'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
