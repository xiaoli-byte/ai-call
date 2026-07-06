import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_SIGNATURE_TOLERANCE_MS = 300_000;

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.SERVICE_API_TOKEN;
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Service token is not configured');
      }
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
    return true;
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
