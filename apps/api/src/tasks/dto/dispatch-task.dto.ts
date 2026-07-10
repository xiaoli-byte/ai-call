import { IsIn, IsOptional } from 'class-validator';

export class DispatchTaskDto {
  @IsOptional()
  @IsIn(['freeswitch', 'web'])
  channel?: 'freeswitch' | 'web';
}
