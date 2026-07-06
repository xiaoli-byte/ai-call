'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_OUTBOUND_RULES,
  type GlobalApiPluginConfig,
  type GlobalOutboundNumberListEntry,
  type GlobalOutboundRulesConfig,
  type UpdateGlobalConfigDto,
  type GlobalVariableConfig,
} from '@ai-call/shared';
import { useGlobalConfig, useGlobalConfigMutations } from '@/hooks/use-global-config';
import { cn } from '@/lib/utils';
import { appToast } from '@/lib/toast';

import styles from './global-config.module.scss';

type GlobalConfigTab = 'variables' | 'api' | 'outbound-rules';
type NumberListKey = 'blockedNumbers' | 'globalWhitelist';

type NumberListRow = {
  key: string;
  item: GlobalOutboundNumberListEntry;
  editing: boolean;
  isNew: boolean;
};

type NumberRowDraft = {
  listKey: NumberListKey;
  original?: GlobalOutboundNumberListEntry;
  draft: GlobalOutboundNumberListEntry;
  isNew: boolean;
};

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`scenario-tab ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function NumberListTable({
  title,
  description,
  rows,
  emptyText,
  savingRowKey,
  onAdd,
  onEdit,
  onChangeDraft,
  onSave,
  onCancel,
  onDelete,
}: {
  title: string;
  description?: string;
  rows: NumberListRow[];
  emptyText: string;
  savingRowKey?: string;
  onAdd: () => void;
  onEdit: (key: string) => void;
  onChangeDraft: (key: string, patch: Partial<GlobalOutboundNumberListEntry>) => void;
  onSave: (key: string) => void;
  onCancel: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  return (
    <div className="global-outbound-list-section">
      <div className="global-outbound-list-title-row">
        <div className="global-outbound-rule-title">{title}</div>
        {description && <div className="global-outbound-tip">{description}</div>}
      </div>
      <button type="button" className="scenario-add-link" onClick={onAdd}>
        <Plus size={14} />
        添加
      </button>
      <div className="scenario-config-scroll">
        <table className="scenario-config-table global-number-list-table">
          <thead>
            <tr>
              <th>创建时间</th>
              <th>电话号码</th>
              <th>创建人</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { item } = row;
              return (
              <tr key={row.key}>
                <td className="global-number-time">{formatListTime(item.createdAt)}</td>
                <td>
                  {row.editing ? (
                    <input
                      className="form-input"
                      value={item.phoneNumber}
                      maxLength={32}
                      onChange={(event) => onChangeDraft(row.key, { phoneNumber: event.target.value })}
                      placeholder="请输入电话号码"
                    />
                  ) : (
                    <span className="global-number-text">{item.phoneNumber}</span>
                  )}
                </td>
                <td className="global-number-user">{item.createdByName || '-'}</td>
                <td>
                  {row.editing ? (
                    <input
                      className="form-input"
                      value={item.remark ?? ''}
                      maxLength={100}
                      onChange={(event) => onChangeDraft(row.key, { remark: event.target.value })}
                      placeholder="请输入备注"
                    />
                  ) : (
                    <span className="global-number-text">{item.remark || '-'}</span>
                  )}
                </td>
                <td>
                  <div className="scenario-config-actions">
                    {row.editing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onSave(row.key)}
                          disabled={savingRowKey === row.key}
                        >
                          {savingRowKey === row.key ? '保存中...' : '保存'}
                        </button>
                        <button type="button" onClick={() => onCancel(row.key)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => onEdit(row.key)}>
                          <Pencil size={14} />
                          编辑
                        </button>
                        <button type="button" onClick={() => onDelete(row.key)}>
                          <Trash2 size={14} />
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="scenario-config-empty">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GlobalConfigPage() {
  const router = useRouter();
  const { data, error, isLoading } = useGlobalConfig();
  const { update } = useGlobalConfigMutations();
  const [tab, setTab] = useState<GlobalConfigTab>('variables');
  const [variables, setVariables] = useState<GlobalVariableConfig[]>([]);
  const [apiPlugins, setApiPlugins] = useState<GlobalApiPluginConfig[]>([]);
  const [outboundRules, setOutboundRules] = useState<GlobalOutboundRulesConfig>(
    cloneOutboundRules(DEFAULT_OUTBOUND_RULES),
  );
  const [numberRowDrafts, setNumberRowDrafts] = useState<Record<string, NumberRowDraft>>({});
  const [savingRowKey, setSavingRowKey] = useState<string>();
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveReadyRef = useRef(false);
  const suppressNextAutoSaveRef = useRef(false);
  const skipNextDataHydrationRef = useRef(false);
  const lastAutoSaveSignatureRef = useRef('');

  useEffect(() => {
    if (!data) return;
    if (skipNextDataHydrationRef.current) {
      skipNextDataHydrationRef.current = false;
      return;
    }
    suppressNextAutoSaveRef.current = true;
    setVariables((data.globalVariables ?? []).map((item) => ({ ...item })));
    setApiPlugins((data.apiPlugins ?? []).map((item) => ({ ...item })));
    const rules = cloneOutboundRules(data.outboundRules ?? DEFAULT_OUTBOUND_RULES);
    setOutboundRules(rules);
    setNumberRowDrafts({});
    autoSaveReadyRef.current = true;
  }, [data]);

  useEffect(() => {
    if (!autoSaveReadyRef.current) return;

    const dto = buildAutoSaveDto(variables, apiPlugins, outboundRules);
    if (dto.outboundRules && dto.outboundRules.callWindow.startTime >= dto.outboundRules.callWindow.endTime) {
      return;
    }
    const signature = JSON.stringify(dto);
    if (suppressNextAutoSaveRef.current) {
      suppressNextAutoSaveRef.current = false;
      lastAutoSaveSignatureRef.current = signature;
      return;
    }
    if (signature === lastAutoSaveSignatureRef.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        skipNextDataHydrationRef.current = true;
        await update(dto);
        lastAutoSaveSignatureRef.current = signature;
      } catch (err) {
        skipNextDataHydrationRef.current = false;
        appToast.error(err);
      }
    }, 600);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [
    apiPlugins,
    outboundRules.callWindow.endTime,
    outboundRules.callWindow.nonHolidayOnly,
    outboundRules.callWindow.startTime,
    outboundRules.callWindow.weekdaysOnly,
    outboundRules.dailyCallLimitPerCallee,
    update,
    variables,
  ]);

  function updateVariable(index: number, patch: Partial<GlobalVariableConfig>) {
    setVariables((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function updatePlugin(index: number, patch: Partial<GlobalApiPluginConfig>) {
    setApiPlugins((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function updateOutboundRules(patch: Partial<GlobalOutboundRulesConfig>) {
    setOutboundRules((prev) => ({ ...prev, ...patch }));
  }

  function updateCallWindow(patch: Partial<GlobalOutboundRulesConfig['callWindow']>) {
    setOutboundRules((prev) => ({
      ...prev,
      callWindow: { ...prev.callWindow, ...patch },
    }));
  }

  function getNumberListRows(listKey: NumberListKey): NumberListRow[] {
    const savedRows = outboundRules[listKey].map((item, index) => {
      const key = createNumberRowKey(listKey, item, index);
      const draft = numberRowDrafts[key];
      return {
        key,
        item: draft?.draft ?? item,
        editing: Boolean(draft),
        isNew: false,
      };
    });
    const newRows = Object.entries(numberRowDrafts)
      .filter(([, draft]) => draft.listKey === listKey && draft.isNew)
      .map(([key, draft]) => ({
        key,
        item: draft.draft,
        editing: true,
        isNew: true,
      }));
    return [...savedRows, ...newRows];
  }

  function addNumberListItem(listKey: NumberListKey) {
    const entry: GlobalOutboundNumberListEntry = {
      id: createListEntryId(),
      phoneNumber: '',
      remark: '',
    };
    const key = createNumberRowKey(listKey, entry);
    setNumberRowDrafts((prev) => ({
      ...prev,
      [key]: { listKey, draft: entry, isNew: true },
    }));
  }

  function editNumberListItem(key: string) {
    const { listKey, item } = findNumberListItemByKey(key);
    if (!listKey || !item) return;
    setNumberRowDrafts((prev) => ({
      ...prev,
      [key]: {
        listKey,
        original: item,
        draft: { ...item },
        isNew: false,
      },
    }));
  }

  function updateNumberListDraft(
    key: string,
    patch: Partial<GlobalOutboundNumberListEntry>,
  ) {
    setNumberRowDrafts((prev) => {
      const draft = prev[key];
      if (!draft) return prev;
      return {
        ...prev,
        [key]: {
          ...draft,
          draft: { ...draft.draft, ...patch },
        },
      };
    });
  }

  function cancelNumberListDraft(key: string) {
    setNumberRowDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function saveNumberListDraft(key: string) {
    const draft = numberRowDrafts[key];
    if (!draft) return;
    const entry = normalizeNumberListEntry(draft.draft);
    if (!entry?.phoneNumber) {
      appToast.error('请输入电话号码');
      return;
    }

    const nextList = draft.isNew
      ? [...outboundRules[draft.listKey], entry]
      : outboundRules[draft.listKey].map((item, index) => (
        createNumberRowKey(draft.listKey, item, index) === key ? entry : item
      ));
    const nextRules = normalizeOutboundRules({
      ...outboundRules,
      [draft.listKey]: nextList,
    });
    const duplicatePhone = findDuplicatePhone(nextRules[draft.listKey]);
    if (duplicatePhone) {
      appToast.error(`号码 ${duplicatePhone} 已存在`);
      return;
    }
    if (hasListIntersection(nextRules.blockedNumbers, nextRules.globalWhitelist)) {
      appToast.error('同一号码不能同时存在于禁止外呼名单和全局白名单');
      return;
    }

    setSavingRowKey(key);
    try {
      skipNextDataHydrationRef.current = true;
      const config = await update({ outboundRules: nextRules });
      setOutboundRules(cloneOutboundRules(config.outboundRules));
      cancelNumberListDraft(key);
      appToast.success('名单已保存');
    } catch (err) {
      skipNextDataHydrationRef.current = false;
      appToast.error(err);
    } finally {
      setSavingRowKey(undefined);
    }
  }

  async function deleteNumberListItem(key: string) {
    const { listKey } = findNumberListItemByKey(key);
    if (!listKey) return;
    const nextRules = normalizeOutboundRules({
      ...outboundRules,
      [listKey]: outboundRules[listKey].filter((item, index) => (
        createNumberRowKey(listKey, item, index) !== key
      )),
    });
    try {
      skipNextDataHydrationRef.current = true;
      const config = await update({ outboundRules: nextRules });
      setOutboundRules(cloneOutboundRules(config.outboundRules));
      cancelNumberListDraft(key);
      appToast.success('名单已删除');
    } catch (err) {
      skipNextDataHydrationRef.current = false;
      appToast.error(err);
    }
  }

  function findNumberListItemByKey(key: string): {
    listKey?: NumberListKey;
    item?: GlobalOutboundNumberListEntry;
  } {
    for (const listKey of ['blockedNumbers', 'globalWhitelist'] as NumberListKey[]) {
      const item = outboundRules[listKey].find((entry, index) => (
        createNumberRowKey(listKey, entry, index) === key
      ));
      if (item) return { listKey, item };
    }
    return {};
  }

  if (error) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-title" style={{ color: 'var(--danger)' }}>全局配置加载失败</div>
          <div className="empty-desc">{error instanceof Error ? error.message : '请检查后端服务'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(styles.workbench, styles.detail)}>
      <div className="scenario-page-title">
        <button type="button" className="scenario-back-icon" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft size={22} />
        </button>
        <div>
          <h1>全局配置</h1>
          <div className="scenario-breadcrumb">配置 / 全局配置</div>
        </div>
      </div>

      <div className="scenario-tabs">
        <TabButton active={tab === 'variables'} onClick={() => setTab('variables')}>变量配置</TabButton>
        <TabButton active={tab === 'api'} onClick={() => setTab('api')}>API插件</TabButton>
        <TabButton active={tab === 'outbound-rules'} onClick={() => setTab('outbound-rules')}>外呼规则</TabButton>
      </div>

      <section className="scenario-section global-config-section">
        {tab === 'variables' && (
          <div className="scenario-global-panel">
            <p className="scenario-muted-line">这些变量可在场景配置、外呼流程和创建任务时复用。</p>
            <div className="scenario-config-scroll">
              <table className="scenario-config-table">
                <thead>
                  <tr>
                    <th>变量名称</th>
                    <th>变量显示名称</th>
                    <th>变量描述</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {variables.map((item, index) => (
                    <tr key={`${item.key}-${index}`}>
                      <td>
                        <input
                          className="form-input"
                          value={item.key}
                          maxLength={50}
                          onChange={(event) => updateVariable(index, { key: event.target.value })}
                          placeholder="请输入变量名称"
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          value={item.label}
                          maxLength={50}
                          onChange={(event) => updateVariable(index, { label: event.target.value })}
                          placeholder="请输入变量显示名称"
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          value={item.description ?? ''}
                          maxLength={100}
                          onChange={(event) => updateVariable(index, { description: event.target.value })}
                          placeholder="请输入变量描述"
                        />
                      </td>
                      <td>
                        <div className="scenario-config-actions">
                          <button
                            type="button"
                            onClick={() => setVariables((prev) => prev.filter((_, i) => i !== index))}
                          >
                            <Trash2 size={14} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {variables.length === 0 && (
                    <tr>
                      <td colSpan={4} className="scenario-config-empty">
                        {isLoading ? '正在加载配置' : '暂无变量配置'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="scenario-add-link"
              onClick={() => setVariables((prev) => [
                ...prev,
                { key: '', label: '', description: '', defaultValue: '' },
              ])}
            >
              <Plus size={14} />
              添加
            </button>
          </div>
        )}

        {tab === 'api' && (
          <div className="scenario-global-panel">
            <p className="scenario-muted-line">这些 API 插件可在外呼流程动作中复用。</p>
            <div className="scenario-config-scroll">
              <table className="scenario-config-table api">
                <thead>
                  <tr>
                    <th>插件名称</th>
                    <th>URL</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {apiPlugins.map((item, index) => (
                    <tr key={`${item.name}-${index}`}>
                      <td>
                        <input
                          className="form-input"
                          value={item.name}
                          onChange={(event) => updatePlugin(index, { name: event.target.value })}
                          placeholder="插件名称"
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          value={item.url ?? ''}
                          onChange={(event) => updatePlugin(index, { url: event.target.value })}
                          placeholder="https://api.example.com"
                        />
                      </td>
                      <td>
                        <label className="scenario-switch">
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={(event) => updatePlugin(index, { enabled: event.target.checked })}
                          />
                          <span>{item.enabled ? '启用' : '停用'}</span>
                        </label>
                      </td>
                      <td>
                        <div className="scenario-config-actions">
                          <button
                            type="button"
                            onClick={() => setApiPlugins((prev) => prev.filter((_, i) => i !== index))}
                          >
                            <Trash2 size={14} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {apiPlugins.length === 0 && (
                    <tr>
                      <td colSpan={4} className="scenario-config-empty">
                        {isLoading ? '正在加载配置' : '暂无 API 插件'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="scenario-add-link"
              onClick={() => setApiPlugins((prev) => [
                ...prev,
                { name: '', enabled: true, method: 'POST', timeoutSeconds: 10 },
              ])}
            >
              <Plus size={14} />
              添加
            </button>
          </div>
        )}

        {tab === 'outbound-rules' && (
          <div className="scenario-global-panel">
            <p className="scenario-muted-line">用于控制全局外呼时间、频控和号码名单。</p>

            <div className="global-outbound-rules">
              <div className="global-outbound-rule-panel">
                <div className="global-outbound-rule-title">可外呼时间段</div>
                <div className="global-outbound-time-row">
                  <label>
                    <span>开始时间</span>
                    <input
                      type="time"
                      className="form-input"
                      value={outboundRules.callWindow.startTime}
                      onChange={(event) => updateCallWindow({ startTime: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>结束时间</span>
                    <input
                      type="time"
                      className="form-input"
                      value={outboundRules.callWindow.endTime}
                      onChange={(event) => updateCallWindow({ endTime: event.target.value })}
                    />
                  </label>
                </div>
                <div className="global-outbound-switches">
                  <label className="scenario-switch">
                    <input
                      type="checkbox"
                      checked={outboundRules.callWindow.weekdaysOnly}
                      onChange={(event) => updateCallWindow({ weekdaysOnly: event.target.checked })}
                    />
                    <span>仅周一至周五外呼</span>
                  </label>
                  <label className="scenario-switch">
                    <input
                      type="checkbox"
                      checked={outboundRules.callWindow.nonHolidayOnly}
                      onChange={(event) => updateCallWindow({ nonHolidayOnly: event.target.checked })}
                    />
                    <span>仅非节假日外呼</span>
                  </label>
                </div>
              </div>

              <div className="global-outbound-rule-panel">
                <label className="global-outbound-field">
                  <span>被叫号码每日拨打上限</span>
                  <input
                    type="number"
                    className="form-input"
                    min={1}
                    max={99}
                    value={outboundRules.dailyCallLimitPerCallee}
                    onChange={(event) => updateOutboundRules({
                      dailyCallLimitPerCallee: Number(event.target.value),
                    })}
                  />
                </label>
              </div>

              <NumberListTable
                title="禁止外呼名单"
                description="请严格按照拨打的号码输入，例如当号码前缀加0时，此处也需要加0。"
                rows={getNumberListRows('blockedNumbers')}
                emptyText={isLoading ? '正在加载配置' : '暂无禁止外呼号码'}
                savingRowKey={savingRowKey}
                onAdd={() => addNumberListItem('blockedNumbers')}
                onEdit={editNumberListItem}
                onChangeDraft={updateNumberListDraft}
                onSave={saveNumberListDraft}
                onCancel={cancelNumberListDraft}
                onDelete={deleteNumberListItem}
              />

              <NumberListTable
                title="全局白名单"
                rows={getNumberListRows('globalWhitelist')}
                emptyText={isLoading ? '正在加载配置' : '暂无白名单号码'}
                savingRowKey={savingRowKey}
                onAdd={() => addNumberListItem('globalWhitelist')}
                onEdit={editNumberListItem}
                onChangeDraft={updateNumberListDraft}
                onSave={saveNumberListDraft}
                onCancel={cancelNumberListDraft}
                onDelete={deleteNumberListItem}
              />
            </div>
          </div>
        )}
      </section>

    </div>
  );
}

function createPluginId(name: string) {
  const readable = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return readable || `api_${Date.now().toString(36)}`;
}

function buildAutoSaveDto(
  variables: GlobalVariableConfig[],
  apiPlugins: GlobalApiPluginConfig[],
  outboundRules: GlobalOutboundRulesConfig,
): UpdateGlobalConfigDto {
  const dto: UpdateGlobalConfigDto = {
    globalVariables: normalizeGlobalVariables(variables),
    outboundRules: normalizeOutboundRules(outboundRules),
  };
  if (!hasIncompletePlugin(apiPlugins)) {
    dto.apiPlugins = normalizeApiPlugins(apiPlugins);
  }
  return dto;
}

function normalizeGlobalVariables(variables: GlobalVariableConfig[]) {
  return variables
    .filter((item) => item.key.trim())
    .map((item) => ({
      ...item,
      key: item.key.trim(),
      label: (item.label ?? '').trim() || item.key.trim(),
      description: item.description?.trim(),
    }));
}

function normalizeApiPlugins(apiPlugins: GlobalApiPluginConfig[]) {
  return apiPlugins
    .filter((item) => item.name.trim() && item.url?.trim())
    .map((item) => ({
      ...item,
      id: item.id || createPluginId(item.name),
      name: item.name.trim(),
      url: item.url?.trim(),
      method: item.method ?? 'POST',
      timeoutSeconds: item.timeoutSeconds ?? 10,
    }));
}

function hasIncompletePlugin(apiPlugins: GlobalApiPluginConfig[]) {
  return apiPlugins.some((item) => {
    const hasName = Boolean(item.name.trim());
    const hasUrl = Boolean((item.url ?? '').trim());
    return hasName !== hasUrl;
  });
}

function cloneOutboundRules(config: GlobalOutboundRulesConfig): GlobalOutboundRulesConfig {
  return {
    callWindow: { ...config.callWindow },
    dailyCallLimitPerCallee: config.dailyCallLimitPerCallee,
    blockedNumbers: cloneNumberList(config.blockedNumbers),
    globalWhitelist: cloneNumberList(config.globalWhitelist),
  };
}

function normalizeOutboundRules(config: GlobalOutboundRulesConfig): GlobalOutboundRulesConfig {
  const dailyLimit = Math.max(
    1,
    Math.min(99, Math.trunc(Number(config.dailyCallLimitPerCallee) || DEFAULT_OUTBOUND_RULES.dailyCallLimitPerCallee)),
  );
  return {
    callWindow: {
      startTime: config.callWindow.startTime || DEFAULT_OUTBOUND_RULES.callWindow.startTime,
      endTime: config.callWindow.endTime || DEFAULT_OUTBOUND_RULES.callWindow.endTime,
      weekdaysOnly: config.callWindow.weekdaysOnly,
      nonHolidayOnly: config.callWindow.nonHolidayOnly,
    },
    dailyCallLimitPerCallee: dailyLimit,
    blockedNumbers: uniqueNumberList(config.blockedNumbers),
    globalWhitelist: uniqueNumberList(config.globalWhitelist),
  };
}

function cloneNumberList(items: GlobalOutboundNumberListEntry[]) {
  return (items as unknown[])
    .map((item) => normalizeNumberListEntry(item))
    .filter((item): item is GlobalOutboundNumberListEntry => Boolean(item));
}

function uniqueNumberList(items: GlobalOutboundNumberListEntry[]) {
  const seen = new Set<string>();
  const result: GlobalOutboundNumberListEntry[] = [];
  for (const item of items) {
    const entry = normalizeNumberListEntry(item);
    if (!entry) continue;
    const phoneNumber = entry.phoneNumber.trim();
    if (!phoneNumber || seen.has(phoneNumber)) continue;
    seen.add(phoneNumber);
    result.push({
      id: entry.id || createListEntryId(),
      phoneNumber,
      createdAt: entry.createdAt,
      createdByUserId: entry.createdByUserId?.trim() || undefined,
      createdByName: entry.createdByName?.trim() || undefined,
      remark: entry.remark?.trim() || undefined,
    });
  }
  return result;
}

function normalizeNumberListEntry(value: unknown): GlobalOutboundNumberListEntry | undefined {
  if (typeof value === 'string') {
    const phoneNumber = value.trim();
    return phoneNumber ? { id: createListEntryId(), phoneNumber } : undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const entry = value as Partial<GlobalOutboundNumberListEntry> & { createdBy?: string };
  const phoneNumber = typeof entry.phoneNumber === 'string' ? entry.phoneNumber.trim() : '';
  if (!phoneNumber && !entry.id) return undefined;
  return {
    id: entry.id || createListEntryId(),
    phoneNumber,
    createdAt: entry.createdAt,
    createdByUserId: entry.createdByUserId,
    createdByName: entry.createdByName ?? entry.createdBy,
    remark: entry.remark,
  };
}

function hasListIntersection(
  left: GlobalOutboundNumberListEntry[],
  right: GlobalOutboundNumberListEntry[],
) {
  const rightSet = new Set(right.map((item) => item.phoneNumber.trim()).filter(Boolean));
  return left.some((item) => rightSet.has(item.phoneNumber.trim()));
}

function createListEntryId() {
  return `number_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createNumberRowKey(
  listKey: NumberListKey,
  item: GlobalOutboundNumberListEntry,
  index = 0,
) {
  return `${listKey}:${item.id || item.phoneNumber || index}`;
}

function findDuplicatePhone(items: GlobalOutboundNumberListEntry[]) {
  const seen = new Set<string>();
  for (const item of items) {
    const phoneNumber = item.phoneNumber.trim();
    if (!phoneNumber) continue;
    if (seen.has(phoneNumber)) return phoneNumber;
    seen.add(phoneNumber);
  }
  return undefined;
}

function formatListTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}
