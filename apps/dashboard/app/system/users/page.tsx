"use client";

import { useMemo, useState } from 'react';
import { useUsers, useUserMutations } from '@/hooks/use-system-users';
import { useRoles } from '@/hooks/use-system-roles';
import { useAuthStore } from '@/lib/auth-store';
import { appToast } from '@/lib/toast';
import type { SystemUser } from '@/lib/api/endpoints/system';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RoleOption {
  id: string;
  name: string;
}

export default function UsersPage() {
  const { user: currentUser } = useAuthStore();
  const { data: usersData, error: usersError, isLoading: usersLoading } = useUsers();
  const { data: rolesData } = useRoles();
  const users: SystemUser[] = usersData ?? [];
  const roles: RoleOption[] = useMemo(
    () => (rolesData ?? []).map((r) => ({ id: r.id, name: r.name })),
    [rolesData],
  );
  const { remove } = useUserMutations();

  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [resettingUser, setResettingUser] = useState<SystemUser | null>(null);

  if (usersLoading) {
    return <div className="empty">加载中...</div>;
  }

  if (usersError) {
    return <div className="empty">加载失败: {usersError.message}</div>;
  }

  async function handleDelete(user: SystemUser) {
    if (!confirm(`确定删除用户 "${user.name}" (${user.email}) 吗？此操作不可撤销。`)) return;
    try {
      await remove(user.id);
      appToast.success('用户已删除');
    } catch (e) {
      appToast.error(e instanceof Error ? e : '删除失败');
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-content">
          <h1 className="page-title">用户管理</h1>
          <p className="subtitle">管理系统用户账号、角色分配与状态</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowCreate(true)}>新建用户</Button>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>
                    {u.name}
                    {u.id === currentUser?.id && (
                      <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                        当前
                      </span>
                    )}
                  </td>
                  <td className="table-mono">{u.email}</td>
                  <td>
                    <div className="tag-list">
                      {u.roles.map((r) => (
                        <span key={r.id} className="badge badge-neutral">
                          {r.name}
                        </span>
                      ))}
                      {u.roles.length === 0 && (
                        <span className="text-muted">未分配</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        u.status === 'active' ? 'badge-success' : 'badge-danger'
                      } badge-dot`}
                    >
                      {u.status === 'active' ? '正常' : '停用'}
                    </span>
                  </td>
                  <td className="table-mono">
                    {new Date(u.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingUser(u)}
                        title="编辑"
                      >
                        编辑
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setResettingUser(u)}
                        title="重置密码"
                      >
                        重置密码
                      </button>
                      {u.email !== 'admin@ai-call.local' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => handleDelete(u)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          roles={roles}
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          roles={roles}
          onClose={() => setEditingUser(null)}
          onSaved={() => setEditingUser(null)}
        />
      )}

      {resettingUser && (
        <ResetPasswordModal
          user={resettingUser}
          onClose={() => setResettingUser(null)}
          onDone={() => setResettingUser(null)}
        />
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
          maxWidth: 480,
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
        <div style={{ padding: '24px' }}>{children}</div>
      </div>
    </div>
  );
}

function CreateUserModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: RoleOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { create } = useUserMutations();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (roleId: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await create({
        email,
        password,
        name,
        roleIds: selectedRoles,
      });
      appToast.success('用户已创建');
      onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      setError(msg);
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="新建用户" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Label htmlFor="new-name">姓名</Label>
          <Input
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ marginTop: 6 }}
          />
        </div>
        <div>
          <Label htmlFor="new-email">邮箱</Label>
          <Input
            id="new-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ marginTop: 6 }}
          />
        </div>
        <div>
          <Label htmlFor="new-password">密码</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ marginTop: 6 }}
          />
        </div>
        <div>
          <Label>角色分配</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {roles.map((r) => (
              <label
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  background: selectedRoles.includes(r.id)
                    ? 'var(--primary-50)'
                    : 'transparent',
                  borderColor: selectedRoles.includes(r.id)
                    ? 'var(--primary-600)'
                    : 'var(--border)',
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(r.id)}
                  onChange={() => toggleRole(r.id)}
                />
                {r.name}
              </label>
            ))}
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
            {submitting ? '创建中...' : '创建用户'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: SystemUser;
  roles: RoleOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { update } = useUserMutations();
  const [name, setName] = useState(user.name);
  const [status, setStatus] = useState(user.status);
  const [selectedRoles, setSelectedRoles] = useState(user.roles.map((r) => r.id));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (roleId: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await update(user.id, {
        name,
        status,
        roleIds: selectedRoles,
      });
      appToast.success('用户已更新');
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
    <Modal title={`编辑用户 - ${user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Label htmlFor="edit-name">姓名</Label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginTop: 6 }}
          />
        </div>
        <div>
          <Label>状态</Label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setStatus('active')}
              style={{
                padding: '6px 16px',
                border: '1px solid',
                borderColor: status === 'active' ? 'var(--primary-600)' : 'var(--border)',
                borderRadius: 'var(--radius)',
                background: status === 'active' ? 'var(--primary-50)' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              正常
            </button>
            <button
              type="button"
              onClick={() => setStatus('inactive')}
              style={{
                padding: '6px 16px',
                border: '1px solid',
                borderColor: status === 'inactive' ? 'var(--danger)' : 'var(--border)',
                borderRadius: 'var(--radius)',
                background: status === 'inactive' ? 'var(--danger-bg)' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              停用
            </button>
          </div>
        </div>
        <div>
          <Label>角色分配</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {roles.map((r) => (
              <label
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  background: selectedRoles.includes(r.id)
                    ? 'var(--primary-50)'
                    : 'transparent',
                  borderColor: selectedRoles.includes(r.id)
                    ? 'var(--primary-600)'
                    : 'var(--border)',
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(r.id)}
                  onChange={() => toggleRole(r.id)}
                />
                {r.name}
              </label>
            ))}
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
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: SystemUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const { resetPassword } = useUserMutations();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(user.id, password);
      appToast.success('密码已重置，用户的所有会话已失效');
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重置失败';
      setError(msg);
      appToast.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`重置密码 - ${user.email}`} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Label htmlFor="reset-password">新密码</Label>
          <Input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ marginTop: 6 }}
          />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            重置后该用户的所有登录会话将立即失效
          </p>
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
            {submitting ? '重置中...' : '重置密码'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
