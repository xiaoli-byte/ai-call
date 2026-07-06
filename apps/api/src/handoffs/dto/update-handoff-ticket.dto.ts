import { IsIn, IsOptional, IsString } from 'class-validator';
import type { HandoffDisposition, HandoffTicketStatus } from '@ai-call/shared';

const STATUSES: HandoffTicketStatus[] = ['pending', 'processing', 'completed', 'closed'];
const DISPOSITIONS: HandoffDisposition[] = [
  'contacted',
  'callback_required',
  'not_interested',
  'converted',
  'complaint_risk',
  'wrong_number',
  'closed',
];

export class UpdateHandoffTicketDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: HandoffTicketStatus;

  @IsOptional()
  @IsIn(DISPOSITIONS)
  disposition?: HandoffDisposition;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
