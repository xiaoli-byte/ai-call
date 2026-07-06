import { IsObject, IsOptional, IsString } from 'class-validator';
import type { GlobalOutboundRulesConfig } from '@ai-call/shared';

export class CompliancePolicyUpdateDto {
  @IsObject()
  outboundRules!: GlobalOutboundRulesConfig;

  @IsOptional()
  @IsString()
  reason?: string;
}
