import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CloudTask, CreateCloudTaskRequest } from './types';

export class CloudDelegationClient {
  private runnerUrl: string;
  private token: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    this.runnerUrl = (config.get<string>('cloudRunnerUrl') || 'http://localhost:4000').replace(/\/+$/, '');
    this.token = config.get<string>('cloudRunnerToken') || '';
  }

  public refreshConfig() {
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    this.runnerUrl = (config.get<string>('cloudRunnerUrl') || 'http://localhost:4000').replace(/\/+$/, '');
    this.token = config.get<string>('cloudRunnerToken') || '';
  }

  public getRunnerUrl(): string {
    return this.runnerUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Check if Cloud Runner server is reachable
   */
  public async checkHealth(): Promise<{ online: boolean; message: string }> {
    try {
      const resp = await fetch(`${this.runnerUrl}/api/health`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      if (resp.ok) {
        const data: any = await resp.json();
        return { online: true, message: data.message || 'Cloud Runner is active and connected' };
      }
      return { online: false, message: `Cloud Runner status: ${resp.statusText}` };
    } catch (err: any) {
      return { online: false, message: `Could not reach Cloud Runner at ${this.runnerUrl} (${err.message})` };
    }
  }

  /**
   * Submit a new heavy task for cloud delegation
   */
  public async submitTask(req: CreateCloudTaskRequest): Promise<CloudTask> {
    const resp = await fetch(`${this.runnerUrl}/api/tasks`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(req)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Failed to delegate task to cloud runner (${resp.status}): ${txt}`);
    }

    return (await resp.json()) as CloudTask;
  }

  /**
   * List all delegated tasks on the cloud runner
   */
  public async listTasks(): Promise<CloudTask[]> {
    const resp = await fetch(`${this.runnerUrl}/api/tasks`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!resp.ok) {
      throw new Error(`Failed to list tasks: ${resp.statusText}`);
    }

    return (await resp.json()) as CloudTask[];
  }

  /**
   * Fetch specific task details
   */
  public async getTask(taskId: string): Promise<CloudTask> {
    const resp = await fetch(`${this.runnerUrl}/api/tasks/${taskId}`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch task: ${resp.statusText}`);
    }

    return (await resp.json()) as CloudTask;
  }

  /**
   * Cancel a cloud task
   */
  public async cancelTask(taskId: string): Promise<void> {
    const resp = await fetch(`${this.runnerUrl}/api/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: this.getHeaders()
    });

    if (!resp.ok) {
      throw new Error(`Failed to cancel task: ${resp.statusText}`);
    }
  }

  /**
   * Stream live progress & logs from the cloud task
   */
  public async streamTask(
    taskId: string,
    onProgress: (task: CloudTask) => void,
    onLog: (line: string) => void,
    onError: (err: string) => void
  ): Promise<void> {
    try {
      const resp = await fetch(`${this.runnerUrl}/api/tasks/${taskId}/stream`, {
        headers: this.getHeaders()
      });

      if (!resp.ok) {
        throw new Error(`Streaming failed with status: ${resp.status}`);
      }

      if (!resp.body) return;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') return;

            try {
              const payload = JSON.parse(dataStr);
              if (payload.log) {
                onLog(payload.log);
              }
              if (payload.task) {
                onProgress(payload.task);
              }
            } catch {
              // ignore json parse error
            }
          }
        }
      }
    } catch (err: any) {
      onError(err.message);
    }
  }

  /**
   * Apply cloud diff or changed files to local workspace
   */
  public async applyCloudChanges(
    task: CloudTask,
    workspaceRoot: string
  ): Promise<{ appliedFiles: string[]; error?: string }> {
    const appliedFiles: string[] = [];

    try {
      // If task has files payload or patch
      if (task.diff) {
        // Save patch to temp file and apply using git apply or custom patcher
        const tempPatchPath = path.join(workspaceRoot, '.ilmu-codex-cloud.patch');
        await fs.promises.writeFile(tempPatchPath, task.diff, 'utf-8');

        const cp = require('child_process');
        await new Promise<void>((resolve, reject) => {
          cp.exec(
            'git apply --reject --whitespace=fix .ilmu-codex-cloud.patch',
            { cwd: workspaceRoot },
            (err: any, stdout: string, stderr: string) => {
              // Remove temporary patch file
              fs.unlink(tempPatchPath, () => {});
              if (err) {
                // If git apply rejected, fallback to reporting
                vscode.window.showWarningMessage(`Git apply warning: ${stderr || err.message}`);
              }
              resolve();
            }
          );
        });

        if (task.filesChanged) {
          appliedFiles.push(...task.filesChanged);
        }
      }

      return { appliedFiles };
    } catch (err: any) {
      return { appliedFiles, error: err.message };
    }
  }
}
