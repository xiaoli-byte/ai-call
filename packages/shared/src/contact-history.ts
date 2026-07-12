import type { CallOutcome, TaskStatus } from './tasks.js';

export interface ContactAttemptHistoryItem {
  id: string;
  phoneNumber: string;
  taskId?: string;
  attemptId?: string;
  status?: TaskStatus | string;
  outcome?: CallOutcome | string;
  attemptedAt: string;
}
