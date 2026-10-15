export type CloudTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface CloudTask {
  id: string;
  title: string;
  prompt: string;
  model: string;
  status: CloudTaskStatus;
  progressPercent: number;
  currentStep?: string;
  logs: string[];
  diff?: string;
  filesChanged?: string[];
  summary?: string;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

export interface CreateCloudTaskRequest {
  title: string;
  prompt: string;
  model?: string;
  files?: Array<{ path: string; content?: string }>;
  branch?: string;
  environmentVars?: Record<string, string>;
}
