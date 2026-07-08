import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SYSTEM_BYPASS_CLS_KEY } from '../prisma/system-context.js';

const DEFAULT_SIGNATURE_TOLERANCE_MS = 300_000;

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(@Optional() private readonly cls?: ClsService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.SERVICE_API_TOKEN;
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Service token is not configured');
      }
      // 开发环境未配置服务令牌：放行并标记系统上下文（服务间调用无用户租户，
      // 需绕过 Prisma 租户强制过滤，见 CALL-03）。
      this.markSystemContext();
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = this.firstHeader(request.headers['x-service-token']);
    if (!provided || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid service token');
    }
    if (this.requiresSignature()) {
      this.assertValidSignature(request.headers, provided, expected);
    }
    // 服务令牌校验通过：可信服务间调用（voice-agent 取任务上下文、FreeSWITCH 事件、
    // 知识库检索等），无用户租户 → 标记系统上下文以绕过租户强制过滤（CALL-03）。
    this.markSystemContext();
    return true;
  }

  /** 在当前 CLS 上下文标记系统旁路（若 CLS 已激活）。 */
  private markSystemContext(): void {
    if (this.cls?.isActive()) {
      this.cls.set(SYSTEM_BYPASS_CLS_KEY, true);
    }
  }

  private assertValidSignature(
    headers: Record<string, string | string[] | undefined>,
    token: string,
    fallbackSecret: string,
  ): void {
    const timestamp = this.firstHeader(headers['x-service-timestamp']);
    const providedSignature = this.firstHeader(headers['x-service-signature']);
    if (!timestamp || !providedSignature) {
      throw new UnauthorizedException('Invalid service signature');
    }

    const timestampMs = Number(timestamp);
    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(Date.now() - timestampMs) > this.signatureToleranceMs()
    ) {
      throw new UnauthorizedException('Service signature timestamp expired');
    }

    const signingSecret = process.env.SERVICE_API_SIGNING_SECRET || fallbackSecret;
    const expectedSignature = createHmac('sha256', signingSecret)
      .update(`${timestamp}.${token}`)
      .digest('hex');
    if (!this.safeEqual(providedSignature, expectedSignature)) {
      throw new UnauthorizedException('Invalid service signature');
    }
  }

  private requiresSignature(): boolean {
    return process.env.SERVICE_API_REQUIRE_SIGNATURE?.toLowerCase() === 'true';
  }

  private signatureToleranceMs(): number {
    const configured = process.env.SERVICE_API_SIGNATURE_TOLERANCE_MS;
    if (!configured) {
      return DEFAULT_SIGNATURE_TOLERANCE_MS;
    }
    const parsed = Number(configured);
    return Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_SIGNATURE_TOLERANCE_MS;
  }

  private firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
