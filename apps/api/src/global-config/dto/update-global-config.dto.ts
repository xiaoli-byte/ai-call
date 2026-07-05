import { IsArray, IsObject, IsOptional } from 'class-validator';
import type {
  GlobalApiPluginConfig,
  GlobalOutboundRulesConfig,
  GlobalVariableConfig,
} from '@ai-call/shared';

export class UpdateGlobalConfigDto {
  @IsOptional()
  @IsArray()
  globalVariables?: GlobalVariableConfig[];

  @IsOptional()
  @IsArray()
  apiPlugins?: GlobalApiPluginConfig[];

  @IsOptional()
  @IsObject()
  outboundRules?: GlobalOutboundRulesConfig;
}
