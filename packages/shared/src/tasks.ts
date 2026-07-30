import type { AgentId } from './agents';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'done'
  | 'error'
  | 'stopped';

export interface Task {
  id: string;
  title: string;
  /** 'auto' = laisse Hermes décider à qui router. */
  target: AgentId | 'auto';
  assignedTo?: AgentId;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}
