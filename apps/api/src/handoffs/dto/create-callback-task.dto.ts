import { IsOptional, IsString } from 'class-validator';

export class CreateCallbackTaskDto {
  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
