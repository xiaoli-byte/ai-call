import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import type { FlowEdge, FlowNode } from '@ai-call/shared';

export class CreateTaskFlowDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  scenarioId?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsArray()
  nodes?: FlowNode[];

  @IsOptional()
  @IsArray()
  edges?: FlowEdge[];
}
