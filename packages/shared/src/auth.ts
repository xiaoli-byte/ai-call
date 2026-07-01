/**
 * 认证与 RBAC 共享类型 / 常量
 */

export const UserStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** 权限代码列表（权限级 RBAC） */
export const PERMISSIONS = {
  // 外呼任务
  TASK_READ: 'task:read',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_DISPATCH: 'task:dispatch',

  // 通话历史
  CALL_READ: 'call:read',

  // 外呼流程
  FLOW_READ: 'flow:read',
  FLOW_CREATE: 'flow:create',
  FLOW_UPDATE: 'flow:update',
  FLOW_DELETE: 'flow:delete',
  FLOW_PUBLISH: 'flow:publish',

  // 场景配置
  SCENARIO_READ: 'scenario:read',
  SCENARIO_UPDATE: 'scenario:update',

  // 知识库
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_CREATE: 'knowledge:create',
  KNOWLEDGE_UPDATE: 'knowledge:update',
  KNOWLEDGE_DELETE: 'knowledge:delete',

  // 系统管理（用户/角色）
  SYSTEM_USER_READ: 'system:user:read',
  SYSTEM_USER_CREATE: 'system:user:create',
  SYSTEM_USER_UPDATE: 'system:user:update',
  SYSTEM_USER_DELETE: 'system:user:delete',
  SYSTEM_ROLE_READ: 'system:role:read',
  SYSTEM_ROLE_CREATE: 'system:role:create',
  SYSTEM_ROLE_UPDATE: 'system:role:update',
  SYSTEM_ROLE_DELETE: 'system:role:delete',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS);

/** 角色权限预定义 */
export const ROLE_TEMPLATES = {
  admin: {
    name: 'admin',
    description: '系统管理员，拥有全部权限',
    permissions: ALL_PERMISSIONS,
  },
  operator: {
    name: 'operator',
    description: '操作员，可管理任务与流程，不可管理系统',
    permissions: [
      PERMISSIONS.TASK_READ,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_UPDATE,
      PERMISSIONS.TASK_DELETE,
      PERMISSIONS.TASK_DISPATCH,
      PERMISSIONS.CALL_READ,
      PERMISSIONS.FLOW_READ,
      PERMISSIONS.FLOW_CREATE,
      PERMISSIONS.FLOW_UPDATE,
      PERMISSIONS.FLOW_DELETE,
      PERMISSIONS.FLOW_PUBLISH,
      PERMISSIONS.SCENARIO_READ,
      PERMISSIONS.SCENARIO_UPDATE,
      PERMISSIONS.KNOWLEDGE_READ,
      PERMISSIONS.KNOWLEDGE_CREATE,
      PERMISSIONS.KNOWLEDGE_UPDATE,
      PERMISSIONS.KNOWLEDGE_DELETE,
    ],
  },
  viewer: {
    name: 'viewer',
    description: '只读用户，仅可查看数据',
    permissions: [
      PERMISSIONS.TASK_READ,
      PERMISSIONS.CALL_READ,
      PERMISSIONS.FLOW_READ,
      PERMISSIONS.SCENARIO_READ,
      PERMISSIONS.KNOWLEDGE_READ,
    ],
  },
} as const;

export type RoleName = (typeof ROLE_TEMPLATES)[keyof typeof ROLE_TEMPLATES]['name'];

export interface Permission {
  id: string;
  code: PermissionCode;
  description: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  roles: Role[];
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  roles: string[];
  permissions: PermissionCode[];
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: UserProfile;
}

export interface CreateUserDto {
  email: string;
  password: string;
  name: string;
  roleIds?: string[];
}

export interface UpdateUserDto {
  email?: string;
  name?: string;
  status?: UserStatus;
  roleIds?: string[];
}

export interface CreateRoleDto {
  name: string;
  description?: string;
  permissionCodes?: PermissionCode[];
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
  permissionCodes?: PermissionCode[];
}
