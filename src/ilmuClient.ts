import * as vscode from 'vscode';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface StreamChunkCallbacks {
  onToken?: (token: string) => void;
  onReasoning?: (reasoning: string) => void;
  onToolCallDelta?: (index: number, id: string | undefined, name: string | undefined, argsChunk: string) => void;
  onUsage?: (promptTokens: number, completionTokens: number, totalTokens: number) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

import { AuthService } from './auth/authService';
import { UsageTracker } from './usageTracker';

export class IlmuClient {
  private apiKey: string;
  private baseUrl: string;
  private authService?: AuthService;
  private usageTracker?: UsageTracker;

  constructor(authService?: AuthService, usageTracker?: UsageTracker) {
    this.authService = authService;
    this.usageTracker = usageTracker;
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    this.apiKey = config.get<string>('apiKey') || process.env.ILMU_API_KEY || '';
    this.baseUrl = (config.get<string>('baseUrl') || 'https://api.ilmu.ai/v1').replace(/\/+$/, '');
  }

  public async refreshConfig() {
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    this.baseUrl = (config.get<string>('baseUrl') || 'https://api.ilmu.ai/v1').replace(/\/+$/, '');
    
    if (this.authService) {
      const stored = await this.authService.getStoredToken();
      this.apiKey = stored || config.get<string>('apiKey') || process.env.ILMU_API_KEY || '';
    } else {
      this.apiKey = config.get<string>('apiKey') || process.env.ILMU_API_KEY || '';
    }
  }

  public async isConfigured(): Promise<boolean> {
    await this.refreshConfig();
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async getApiKey(): Promise<string> {
    await this.refreshConfig();
    return this.apiKey;
  }

  public getRawApiKey(): string {
    return this.apiKey;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Test API connectivity to ILMU endpoint
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    const configured = await this.isConfigured();
    if (!configured) {
      return {
        success: false,
        message: 'No ILMU API key or OAuth session found. Please sign in or set your sk- token in Settings.'
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'ilmu-mini-v3.3',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: `ILMU API returned status ${response.status}: ${errorText}`
        };
      }

      return {
        success: true,
        message: 'Connection to ILMU API verified successfully!'
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error connecting to ${this.baseUrl}: ${err.message}`
      };
    }
  }

  /**
   * Stream a chat completion with full tool-calling support
   */
  public async streamChat(
    model: string,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    callbacks: StreamChunkCallbacks,
    abortSignal?: AbortSignal
  ): Promise<{ fullContent: string; fullReasoning: string; toolCalls: ToolCall[] }> {
    const configured = await this.isConfigured();
    if (!configured) {
      throw new Error('ILMU API Key or OAuth session is not configured. Please Sign In or add sk-... key to Settings.');
    }

    const payload: any = {
      model,
      messages,
      stream: true
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!response.ok) {
      let errBody = '';
      try {
        errBody = await response.text();
      } catch {
        errBody = response.statusText;
      }

      if (response.status === 401) {
        throw new Error(`ILMU Authentication error (401): Invalid API Key. Please verify your sk- token.`);
      } else if (response.status === 402) {
        throw new Error(`ILMU Billing limit reached (402): Insufficient PAYG balance or quota on console.ilmu.ai.`);
      } else if (response.status === 429) {
        throw new Error(`ILMU Rate limit exceeded (429): Please wait a moment before sending more requests.`);
      } else {
        throw new Error(`ILMU API error (${response.status}): ${errBody}`);
      }
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    let fullContent = '';
    let fullReasoning = '';
    const toolCallAccumulator: Record<number, { id: string; name: string; args: string }> = {};

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed === 'data: [DONE]') {
            callbacks.onDone?.();
            break;
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (!delta) continue;

              // Check for reasoning content (common in thinking models like ilmu-v3.1, ilmu-glm-5.3)
              if (delta.reasoning_content) {
                fullReasoning += delta.reasoning_content;
                callbacks.onReasoning?.(delta.reasoning_content);
              }

              // Check for regular content tokens
              if (delta.content) {
                fullContent += delta.content;
                callbacks.onToken?.(delta.content);
              }

              // Check for streaming tool calls
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallAccumulator[idx]) {
                    toolCallAccumulator[idx] = {
                      id: tc.id || '',
                      name: tc.function?.name || '',
                      args: tc.function?.arguments || ''
                    };
                  } else {
                    if (tc.id) toolCallAccumulator[idx].id = tc.id;
                    if (tc.function?.name) toolCallAccumulator[idx].name += tc.function.name;
                    if (tc.function?.arguments) toolCallAccumulator[idx].args += tc.function.arguments;
                  }

                  callbacks.onToolCallDelta?.(
                    idx,
                    tc.id,
                    tc.function?.name,
                    tc.function?.arguments || ''
                  );
                }
              }
              // Capture token usage from stream if provided by model
              if (parsed.usage) {
                const promptTokens = parsed.usage.prompt_tokens || 0;
                const completionTokens = parsed.usage.completion_tokens || 0;
                const totalTokens = parsed.usage.total_tokens || (promptTokens + completionTokens);
                callbacks.onUsage?.(promptTokens, completionTokens, totalTokens);
                if (this.usageTracker) {
                  this.usageTracker.recordUsage(model, totalTokens);
                }
              }
            } catch (parseErr) {
              // Ignore non-json chunk or partial chunk
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Generation aborted by user.');
      }
      callbacks.onError?.(err);
      throw err;
    } finally {
      callbacks.onDone?.();
      // If server didn't emit a usage object, estimate tokens (~4 chars/token) and record
      if (this.usageTracker) {
        const estTokens = Math.max(1, Math.round((fullContent.length + fullReasoning.length) / 4));
        this.usageTracker.recordUsage(model, estTokens);
      }
    }

    const finalToolCalls: ToolCall[] = Object.values(toolCallAccumulator).map(tc => ({
      id: tc.id || `call_${Date.now()}`,
      type: 'function',
      function: {
        name: tc.name,
        arguments: tc.args
      }
    }));

    return {
      fullContent,
      fullReasoning,
      toolCalls: finalToolCalls
    };
  }
}
