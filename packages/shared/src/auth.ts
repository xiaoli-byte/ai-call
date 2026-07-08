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

  // 以下模块 CALL-04「去贴标签」：各自持有 3 段码 call:{module}:{action}，
  // 不再借用 task:*/call:read/scenario:*/system:role:* 等其它模块的权限码。

  // 营销活动（外呼批次）
  CAMPAIGN_READ: 'call:campaign:read',
  CAMPAIGN_CREATE: 'call:campaign:create',
  CAMPAIGN_UPDATE: 'call:campaign:update',

  // 通话质检
  QUALITY_READ: 'call:quality:read',

  // 合规策略与审计
  COMPLIANCE_READ: 'call:compliance:read',
  COMPLIANCE_UPDATE: 'call:compliance:update',

  // 数据分析
  ANALYTICS_READ: 'call:analytics:read',

  // 租户管理（管理员专属）
  TENANT_READ: 'call:tenant:read',
  TENANT_CREATE: 'call:tenant:create',
  TENANT_UPDATE: 'call:tenant:update',
  TENANT_DELETE: 'call:tenant:delete',

  // 平台管理（跨租户可观测性/成本/组织/模板，管理员专属）
  PLATFORM_READ: 'call:platform:read',
  PLATFORM_CREATE: 'call:platform:create',
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
      // 业务模块（CALL-04 去贴标签后，operator 保留与此前等价的可见范围）
      PERMISSIONS.CAMPAIGN_READ,
      PERMISSIONS.CAMPAIGN_CREATE,
      PERMISSIONS.CAMPAIGN_UPDATE,
      PERMISSIONS.QUALITY_READ,
      PERMISSIONS.COMPLIANCE_READ,
      PERMISSIONS.COMPLIANCE_UPDATE,
      PERMISSIONS.ANALYTICS_READ,
      // 注意：租户管理（call:tenant:*）与平台管理（call:platform:*）为管理员专属，
      // 不授予 operator/viewer。
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
      // 业务模块只读（CALL-04）
      PERMISSIONS.CAMPAIGN_READ,
      PERMISSIONS.QUALITY_READ,
      PERMISSIONS.COMPLIANCE_READ,
      PERMISSIONS.ANALYTICS_READ,
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
