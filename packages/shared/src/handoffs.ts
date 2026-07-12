export type HandoffTicketStatus = 'pending' | 'processing' | 'completed' | 'closed';
export type HandoffDisposition =
  | 'contacted'
  | 'callback_required'
  | 'not_interested'
  | 'converted'
  | 'complaint_risk'
  | 'wrong_number'
  | 'closed';

export interface HandoffTicket {
  id: string;
  status: HandoffTicketStatus;
  taskId: string;
  callAttemptId?: string;
  callAnalysisId?: string;
  phoneNumber: string;
  customerName?: string;
  summary: string;
  intent: string;
  riskTags: string[];
  recommendedAction: string;
  disposition?: HandoffDisposition;
  notes?: string;
  assignedTo?: string;
  callbackTaskId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface HandoffListPage {
  items: HandoffTicket[];
  counts: Record<HandoffTicketStatus, number>;
  nextCursor?: string;
}

export interface UpdateHandoffTicketDto {
  status?: HandoffTicketStatus;
  disposition?: HandoffDisposition;
  notes?: string;
  assignedTo?: string;
}

export interface CreateCallbackTaskDto {
  scheduledAt?: string;
  assignedTo?: string;
}
