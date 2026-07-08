import type { RolePermissionMap } from '@xiaoli-byte/authz/core';

let current: RolePermissionMap = {};

export function getRolePermissionMap(): RolePermissionMap {
  return current;
}

export function setRolePermissionMap(map: RolePermissionMap): void {
  current = map;
}
