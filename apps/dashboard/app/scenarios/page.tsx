import { apiServer } from '@/lib/api/server';

const SCENARIO_BADGE: Record<string, string> = {
  collection: 'badge-warning',
  ecommerce: 'badge-info',
  presale: 'badge-primary',
};

export default async function ScenariosPage() {
  let scenarios: Awaited<ReturnType<typeof apiServer.listScenarios>> = [];
  try {
    scenarios = await apiServer.listScenarios();
  } catch {
    // 后端未启动时使用内置配置展示
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">场景配置</h1>
          <p className="subtitle">查看各场景的话术、工具白名单、转人工规则</p>
        </div>
      </div>

      {scenarios.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-title">无法连接后端</div>
            <div className="empty-desc">请先启动：<code>cd apps/api && pnpm dev</code></div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {scenarios.map((s) => (
            <div key={s.scenario} className="card">
              <div className="card-header">
                <div>
                  <div className="card-title" style={{ fontSize: 16 }}>{s.name}</div>
                  <div className="card-subtitle" style={{ marginTop: 4 }}>{s.description}</div>
                </div>
                <span className={`badge ${SCENARIO_BADGE[s.scenario] ?? 'badge-neutral'}`}>
                  {s.scenario}
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">问候语模板</label>
                <div className="architecture" style={{ fontSize: 13, padding: 14 }}>
                  {s.greeting}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">System Prompt</label>
                <textarea
                  className="form-textarea form-mono"
                  value={s.systemPrompt}
                  readOnly
                  style={{ minHeight: 220 }}
                />
              </div>

              <div className="grid grid-2">
                <div>
                  <label className="form-label">可用工具</label>
                  <div className="tag-list">
                    {s.allowedTools.map((t) => (
                      <span key={t} className="badge badge-info">{t}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="form-label">转人工规则</label>
                  <ul style={{ paddingLeft: 0, listStyle: 'none', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.8 }}>
                    {s.escalationRules.map((r, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text)', fontWeight: 500 }}>• {r.description}</span>
                        {r.keywords && (
                          <div style={{ marginLeft: 12, marginTop: 2 }}>
                            {r.keywords.map((k) => (
                              <span key={k} className="badge badge-neutral" style={{ marginRight: 4 }}>“{k}”</span>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}