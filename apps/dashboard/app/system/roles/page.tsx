"use client";

import { useState } from 'react';
import { useRoles, useRoleMutations } from '@/hooks/use-system-roles';
import { usePermissions } from '@/hooks/use-permission';
import { useThrottleFn } from '@/hooks/use-throttle-fn';
import { appToast } from '@/lib/toast';
import type { SystemRole } from '@/lib/api/endpoints/system';
import { PERMISSIONS } from '@ai-call/shared';
import type { PermissionCode } from '@ai-call/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PERMISSION_GROUPS: Array<{ label: string; codes: PermissionCode[] }> = [
  {
    label: '外呼任务',
    codes: [
      PERMISSIONS.TASK_READ,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_UPDATE,
      PERMISSIONS.TASK_DELETE,
      PERMISSIONS.TASK_DISPATCH,
    ],
  },
  {
    label: '通话历史',
    codes: [PERMISSIONS.CALL_READ],
  },
  {
    label: '外呼流程',
    codes: [
      PERMISSIONS.FLOW_READ,
      PERMISSIONS.FLOW_CREATE,
      PERMISSIONS.FLOW_UPDATE,
      PERMISSIONS.FLOW_DELETE,
      PERMISSIONS.FLOW_PUBLISH,
    ],
  },
  {
    label: '场景配置',
    codes: [PERMISSIONS.SCENARIO_READ, PERMISSIONS.SCENARIO_UPDATE],
  },
  {
    label: '知识库',
    codes: [
      PERMISSIONS.KNOWLEDGE_READ,
      PERMISSIONS.KNOWLEDGE_CREATE,
      PERMISSIONS.KNOWLEDGE_UPDATE,
      PERMISSIONS.KNOWLEDGE_DELETE,
    ],
  },
  {
    label: '系统管理 - 用户',
    codes: [
      PERMISSIONS.SYSTEM_USER_READ,
      PERMISSIONS.SYSTEM_USER_CREATE,
      PERMISSIONS.SYSTEM_USER_UPDATE,
      PERMISSIONS.SYSTEM_USER_DELETE,
    ],
  },
  {
    label: '系统管理 - 角色',
    codes: [
      PERMISSIONS.SYSTEM_ROLE_READ,
      PERMISSIONS.SYSTEM_ROLE_CREATE,
      PERMISSIONS.SYSTEM_ROLE_UPDATE,
      PERMISSIONS.SYSTEM_ROLE_DELETE,
    ],
  },
];

export default function RolesPage() {
  const { data: rolesData, error: rolesError, isLoading: rolesLoading } = useRoles();
  const { remove } = useRoleMutations();
  const { has } = usePermissions();
  const canCreate = has(PERMISSIONS.SYSTEM_ROLE_CREATE);
  const canUpdate = has(PERMISSIONS.SYSTEM_ROLE_UPDATE);
  const canDelete = has(PERMISSIONS.SYSTEM_ROLE_DELETE);
  // 删除按钮点击后直接发起网络请求且没有 pending 保护，用节流防止连点重复提交；
  // handleDeleteRole 是函数声明（下方定义），会被提升，这里引用是安全的。
  const throttledDeleteRole = useThrottleFn(handleDeleteRole);
  const roles: SystemRole[] = rolesData ?? [];
  const [showCreate, setShowCreate] = useState(false);
  const [editingRole, setEditingRole] = useState<SystemRole | null>(null);

  if (rolesLoading) {
    return <div className="empty">加载中...</div>;
  }

  if (rolesError) {
    return <div className="empty">加载失败: {rolesError.message}</div>;
  }

  async function handleDeleteRole(role: SystemRole) {
    if (!confirm(`确定删除角色 "${role.name}" 吗？`)) return;
    try {
      await remove(role.id);
      appToast.success('角色已删除');
    } catch (e) {
      appToast.error(e instanceof Error ? e : '删除失败');
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">角色权限</h1>
          <p className="subtitle">管理系统角色与权限分配</p>
        </div>
        <div className="page-actions">
          {canCreate && <Button onClick={() => setShowCreate(true)}>新建角色</Button>}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {roles.map((role) => (
          <div key={role.id} className="card">
            <div className="card-header">
              <div>
                <div className="card-title">
                  {role.name}
                  {role.name === 'admin' && (
                    <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                      系统内置
                    </span>
                  )}
                </div>
                <div className="card-subtitle">{role.description}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge badge-neutral">
                  {role.userCount} 用户
                </span>
                <span className="badge badge-info">
                  {role.permissions.length} 权限
                </span>
                {canUpdate && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditingRole(role)}
                  >
                    编辑权限
                  </button>
                )}
                {canDelete && role.name !== 'admin' && role.userCount === 0 && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => throttledDeleteRole(role)}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>

            <div className="tag-list">
              {role.permissions.map((p) => (
                <span key={p.id} className="badge badge-neutral table-mono">
                  {p.code}
                </span>
              ))}
              {role.permissions.length === 0 && (
                <span className="text-muted">无权限</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <RoleModal
          title="新建角色"
          onClose={() => setShowCreate(false)}
          onSaved={() => setShowCreate(false)}
        />
      )}

      {editingRole && (
        <RoleModal
          title={`编辑角色 - ${editingRole.name}`}
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSaved={() => setEditingRole(null)}
        />
      )}
    </div>
  );
}

function RoleModal({
  title,
  role,
  onClose,
  onSaved,
}: {
  title: string;
  role?: SystemRole;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { create, update } = useRoleMutations();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selectedPerms, setSelectedPerms] = useState<Set<PermissionCode>>(
    new Set(role?.permissions.map((p) => p.code) ?? []),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePerm = (code: PermissionCode) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleGroup = (codes: PermissionCode[]) => {
    setSelectedPerms((prev) => {
      const allSelected = codes.every((c) => prev.has(c));
      const next = new Set(prev);
      if (allSelected) {
        codes.forEach((c) => next.delete(c));
      } else {
        codes.forEach((c) => next.add(c));
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const permCodes = Array.from(selectedPerms);
      if (role) {
        await update(role.id, {
          name,
          description,
          permissionCodes: permCodes,
        });
        appToast.success('角色已更新');
      } else {
        await create({
          name,
          description,
          permissionCodes: permCodes,
        });
        appToast.success('角色已创建');
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: 'var(--text-muted)',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <form
          onSubmit={handleSubmit}
          style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <Label htmlFor="role-name">角色名称</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={role?.name === 'admin'}
                style={{ marginTop: 6 }}
              />
            </div>
            <div style={{ flex: 2 }}>
              <Label htmlFor="role-desc">描述</Label>
              <Input
                id="role-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ marginTop: 6 }}
              />
            </div>
          </div>

          <div>
            <Label>权限分配 ({selectedPerms.size} 项)</Label>
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              {PERMISSION_GROUPS.map((group) => {
                const allSelected = group.codes.every((c) =>
                  selectedPerms.has(c),
                );
                return (
                  <div
                    key={group.label}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {group.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.codes)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 12,
                          color: allSelected
                            ? 'var(--primary-600)'
                            : 'var(--text-muted)',
                        }}
                      >
                        {allSelected ? '取消全选' : '全选'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {group.codes.map((code) => (
                        <label
                          key={code}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            border: '1px solid',
                            borderColor: selectedPerms.has(code)
                              ? 'var(--primary-600)'
                              : 'var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            background: selectedPerms.has(code)
                              ? 'var(--primary-50)'
                              : 'transparent',
                            cursor: 'pointer',
                            fontSize: 12,
                            fontFamily: 'SF Mono, Monaco, monospace',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPerms.has(code)}
                            onChange={() => togglePerm(code)}
                            style={{ width: 14, height: 14 }}
                          />
                          {code}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
