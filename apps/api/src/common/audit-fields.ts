import type { UserProfile } from '@ai-call/shared';

export interface AuditActor {
  id: string;
  name: string;
}

export interface CreateAuditFields {
  createdAt?: string;
  createdByUserId?: string;
  createdByName?: string;
}

export function auditActorFromUser(user?: Pick<UserProfile, 'id' | 'name'>): AuditActor {
  return {
    id: user?.id ?? 'system',
    name: user?.name ?? '系统',
  };
}

export function withCreateAuditFields<T extends CreateAuditFields>(
  value: T,
  actor: AuditActor,
  now = new Date(),
): T {
  return {
    ...value,
    createdAt: value.createdAt || now.toISOString(),
    createdByUserId: value.createdByUserId || actor.id,
    createdByName: value.createdByName || actor.name,
  };
}
