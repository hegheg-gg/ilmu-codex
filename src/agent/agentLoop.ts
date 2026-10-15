import * as vscode from 'vscode';
import { ChatMessage, IlmuClient, ToolCall } from '../ilmuClient';
import { AGENT_TOOLS, executeAgentTool, ToolExecutionContext } from './tools';
import { ContextManager } from './contextManager';

export interface AgentProgressCallbacks {
  onToken: (token: string) => void;
  onReasoning: (reasoning: string) => void;
  onToolStart: (toolName: string, args: Record<string, any>) => void;
  onToolResult: (toolName: string, output: string) => void;
  onConfirmRequest: (description: string) => Promise<boolean>;
  onError: (errMsg: string) => void;
  onDone: () => void;
}

export class AgentLoop {
  private client: IlmuClient;
  private abortController: AbortController | null = null;
  private conversationHistory: ChatMessage[] = [];

  constructor(client: IlmuClient) {
    this.client = client;
  }

  public resetConversation() {
    this.conversationHistory = [];
  }

  public cancelCurrentTurn() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public async runTurn(
    userPrompt: string,
    model: string,
    callbacks: AgentProgressCallbacks
  ) {
    this.abortController = new AbortController();
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    const autoApproveReadOnly = config.get<boolean>('autoApproveReadOnly', true);
    const preferredLanguage = config.get<string>('preferredLanguage', 'English');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();

    const editorCtx = ContextManager.getActiveEditorContext();
    const formattedCtx = ContextManager.formatContextPrompt(editorCtx);

    // Initial system prompt setup
    if (this.conversationHistory.length === 0) {
      const systemPrompt = `You are ILMU Codex, an expert AI pair programming agent integrated side-by-side into the IDE (Google Antigravity / VS Code).
You are powered by ILMU AI (YTL AI Labs, Malaysia).

Your capabilities:
- You have real tools to inspect, modify, create, and test code in the user's workspace.
- You can read files (read_file), write files (write_file), apply targeted diffs (apply_diff), list directories (list_dir), grep search (grep_search), and run terminal commands (run_command).
- You can explain architecture, write idiomatic code, write unit tests, debug runtime errors, and plan large refactorings.
- Communication preference: ${preferredLanguage}. (You are fully fluent in formal Bahasa Malaysia, English, and natural Malaysian developer code-switching/Manglish when helpful).
- Strive for production-ready, clean, performant, and well-structured code. Never invent imaginary files without checking first.

Current Workspace Environment:
${formattedCtx}
`;
      this.conversationHistory.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // Add user message with active context snapshot
    let messageContent = userPrompt;
    if (editorCtx.selectedText) {
      messageContent += `\n\n[Active Context Snapshot]\nFile: ${editorCtx.activeFileRelative || 'unknown'}\nSelected Snippet:\n\`\`\`${editorCtx.fileLanguage || ''}\n${editorCtx.selectedText}\n\`\`\``;
    }

    this.conversationHistory.push({
      role: 'user',
      content: messageContent
    });

    const toolExecutionContext: ToolExecutionContext = {
      workspaceRoot,
      onConfirmAction: async (actionDescription: string) => {
        // Auto approve read-only actions if configured
        if (
          autoApproveReadOnly &&
          (actionDescription.startsWith('read_file') ||
            actionDescription.startsWith('list_dir') ||
            actionDescription.startsWith('grep_search'))
        ) {
          return true;
        }
        return await callbacks.onConfirmRequest(actionDescription);
      }
    };

    let turns = 0;
    const MAX_TURNS = 12;

    try {
      while (turns < MAX_TURNS) {
        turns++;
        if (this.abortController?.signal.aborted) {
          callbacks.onError('Turn cancelled by user.');
          break;
        }

        let currentAssistantTokenChunk = '';
        let currentReasoningChunk = '';

        const result = await this.client.streamChat(
          model,
          this.conversationHistory,
          AGENT_TOOLS,
          {
            onToken: (t) => {
              currentAssistantTokenChunk += t;
              callbacks.onToken(t);
            },
            onReasoning: (r) => {
              currentReasoningChunk += r;
              callbacks.onReasoning(r);
            },
            onToolCallDelta: () => {},
            onError: (err) => {
              callbacks.onError(err.message);
            }
          },
          this.abortController.signal
        );

        // Record assistant response in conversation
        this.conversationHistory.push({
          role: 'assistant',
          content: result.fullContent || null,
          tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined
        });

        // If there are no tool calls, the model has finished its turn
        if (!result.toolCalls || result.toolCalls.length === 0) {
          callbacks.onDone();
          break;
        }

        // Execute each tool call and append tool messages
        for (const tc of result.toolCalls) {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }

          callbacks.onToolStart(tc.function.name, parsedArgs);

          const output = await executeAgentTool(
            tc.function.name,
            parsedArgs,
            toolExecutionContext
          );

          callbacks.onToolResult(tc.function.name, output);

          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: output
          });
        }
      }

      if (turns >= MAX_TURNS) {
        callbacks.onToken('\n*(Reached maximum tool iterations for this turn)*');
        callbacks.onDone();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        callbacks.onError(err.message);
      }
    } finally {
      this.abortController = null;
    }
  }
}
