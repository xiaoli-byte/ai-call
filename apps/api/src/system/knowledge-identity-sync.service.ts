import { BadGatewayException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_TENANT_ID } from '../auth/auth.config.js';
import { resolveKnowledgeRoleClaims } from '../auth/knowledge-role-claims.js';

export interface KnowledgeIdentity {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: string[];
}

/** CALL-13 projection from ai-call (identity source) to ai-knowledge. */
@Injectable()
export class KnowledgeIdentitySyncService {
  private readonly logger = new Logger(KnowledgeIdentitySyncService.name);
  private readonly baseUrl = process.env.KNOWLEDGE_SERVICE_BASE_URL?.replace(/\/+$/, '');
  private readonly serviceToken = process.env.KNOWLEDGE_SERVICE_API_TOKEN;
  private readonly timeoutMs = Number(process.env.KNOWLEDGE_SERVICE_TIMEOUT_MS ?? 5000);

  async sync(user: KnowledgeIdentity): Promise<void> {
    if (!this.baseUrl) return;
    const [role = 'viewer'] = resolveKnowledgeRoleClaims(user.roles);
    await this.request('/federation/users/sync', 'PUT', user.id, role, {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      status: user.status === 'active' ? 'active' : 'inactive',
    });
  }

  async remove(id: string, roles: string[]): Promise<void> {
    if (!this.baseUrl) return;
    const [role = 'viewer'] = resolveKnowledgeRoleClaims(roles);
    await this.request(`/federation/users/${encodeURIComponent(id)}`, 'DELETE', id, role);
  }

  private async request(
    path: string,
    method: 'PUT' | 'DELETE',
    userId: string,
    role: string,
    body?: unknown,
  ): Promise<void> {
    if (!this.serviceToken) {
      throw new BadGatewayException(
        'KNOWLEDGE_SERVICE_API_TOKEN is required when knowledge identity sync is enabled',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.serviceToken,
          'x-tenant-id': DEFAULT_TENANT_ID,
          'x-user-id': userId,
          'x-user-role': role,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) return;
      const detail = await response.text().catch(() => '');
      if (response.status === 409) {
        throw new ConflictException('Email conflicts with an existing ai-knowledge account');
      }
      throw new BadGatewayException(
        `ai-knowledge identity sync failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadGatewayException) throw error;
      this.logger.warn(`ai-knowledge identity sync request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new BadGatewayException('ai-knowledge identity sync is unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}
