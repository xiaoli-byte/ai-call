import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RunScenarioTestDto {
  @IsOptional()
  @IsString()
  flowId?: string;

  @IsOptional()
  @IsString()
  flowVersionId?: string;

  @IsString()
  input!: string;

  @IsOptional()
  @IsString()
  expectedOutcome?: string;

  @IsOptional()
  @IsBoolean()
  golden?: boolean;
}
