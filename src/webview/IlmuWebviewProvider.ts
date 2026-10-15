import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IlmuClient } from '../ilmuClient';
import { AgentLoop } from '../agent/agentLoop';
import { CloudDelegationClient } from '../cloud/cloudDelegation';
import { ContextManager } from '../agent/contextManager';
import { AuthService } from '../auth/authService';
import { CloudTask } from '../cloud/types';
import { UsageTracker } from '../usageTracker';

export class IlmuWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ilmuCodex.sidebar';

  private _view?: vscode.WebviewView;
  private ilmuClient: IlmuClient;
  private agentLoop: AgentLoop;
  private cloudClient: CloudDelegationClient;
  private authService: AuthService;
  private usageTracker: UsageTracker;
  private pendingConfirmationResolver?: (approved: boolean) => void;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    ilmuClient: IlmuClient,
    cloudClient: CloudDelegationClient,
    authService: AuthService,
    usageTracker: UsageTracker
  ) {
    this.ilmuClient = ilmuClient;
    this.cloudClient = cloudClient;
    this.authService = authService;
    this.usageTracker = usageTracker;
    this.agentLoop = new AgentLoop(ilmuClient);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen to messages from the Webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'init': {
          await this.sendInitialState();
          break;
        }

        case 'startWebSignIn': {
          try {
            await this.authService.startWebOAuthFlow();
            vscode.window.showInformationMessage('Successfully connected ILMU Codex!');
            await this.sendInitialState();
          } catch (err: any) {
            vscode.window.showErrorMessage(`Sign in notice: ${err.message}`);
            this._view?.webview.postMessage({
              command: 'authError',
              error: err.message
            });
          }
          break;
        }

        case 'signOut': {
          await this.authService.signOut();
          vscode.window.showInformationMessage('Signed out of ILMU Codex.');
          await this.sendInitialState();
          break;
        }

        case 'sendUserMessage': {
          await this.handleUserMessage(message.text, message.model);
          break;
        }

        case 'cancelTurn': {
          this.agentLoop.cancelCurrentTurn();
          this._view?.webview.postMessage({ command: 'turnCancelled' });
          break;
        }

        case 'clearChat': {
          this.agentLoop.resetConversation();
          this._view?.webview.postMessage({ command: 'chatCleared' });
          break;
        }

        case 'confirmActionResponse': {
          if (this.pendingConfirmationResolver) {
            this.pendingConfirmationResolver(message.approved);
            this.pendingConfirmationResolver = undefined;
          }
          break;
        }

        case 'saveSettings': {
          const config = vscode.workspace.getConfiguration('ilmuCodex');
          if (message.apiKey !== undefined && message.apiKey.trim()) {
            await this.authService.setToken(message.apiKey.trim());
          }
          if (message.model !== undefined) {
            await config.update('model', message.model, vscode.ConfigurationTarget.Global);
          }
          if (message.preferredLanguage !== undefined) {
            await config.update('preferredLanguage', message.preferredLanguage, vscode.ConfigurationTarget.Global);
          }
          if (message.cloudRunnerUrl !== undefined) {
            await config.update('cloudRunnerUrl', message.cloudRunnerUrl, vscode.ConfigurationTarget.Global);
          }
          await this.ilmuClient.refreshConfig();
          this.cloudClient.refreshConfig();
          vscode.window.showInformationMessage('ILMU Codex settings saved.');
          await this.sendInitialState();
          break;
        }

        case 'testConnection': {
          await this.ilmuClient.refreshConfig();
          const res = await this.ilmuClient.testConnection();
          this._view?.webview.postMessage({
            command: 'connectionTestResult',
            success: res.success,
            message: res.message
          });
          break;
        }

        case 'delegateCloudTask': {
          await this.handleCloudTaskDelegation(message.title, message.prompt, message.model);
          break;
        }

        case 'refreshCloudTasks': {
          await this.refreshCloudTasks();
          break;
        }

        case 'resetUsageStats': {
          await this.usageTracker.resetStats();
          vscode.window.showInformationMessage('Model usage statistics reset.');
          await this.sendInitialState();
          break;
        }

        case 'cancelCloudTask': {
          try {
            await this.cloudClient.cancelTask(message.taskId);
            vscode.window.showInformationMessage(`Cloud Task ${message.taskId} cancelled.`);
            await this.refreshCloudTasks();
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to cancel task: ${err.message}`);
          }
          break;
        }

        case 'applyCloudDiff': {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace open to apply changes.');
            return;
          }
          const task = message.task as CloudTask;
          const res = await this.cloudClient.applyCloudChanges(task, workspaceFolder.uri.fsPath);
          if (res.error) {
            vscode.window.showErrorMessage(`Error applying cloud changes: ${res.error}`);
          } else {
            vscode.window.showInformationMessage(`Applied cloud changes for: ${task.title}`);
          }
          break;
        }

        case 'insertCodeAtCursor': {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            await editor.edit((editBuilder) => {
              editBuilder.insert(editor.selection.active, message.code);
            });
            vscode.window.showInformationMessage('Inserted code snippet at cursor.');
          } else {
            vscode.window.showWarningMessage('No active editor to insert code into.');
          }
          break;
        }

        case 'applyCodeToActiveFile': {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            const document = editor.document;
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length)
            );
            await editor.edit((editBuilder) => {
              editBuilder.replace(fullRange, message.code);
            });
            vscode.window.showInformationMessage(`Applied code to ${path.basename(document.fileName)}`);
          } else {
            vscode.window.showWarningMessage('No active editor file to replace.');
          }
          break;
        }

        case 'openFile': {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (workspaceFolder) {
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, message.path);
            vscode.commands.executeCommand('vscode.open', fileUri);
          }
          break;
        }
      }
    });

    // Notify webview when active editor changes
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.sendActiveContext();
    });

    vscode.window.onDidChangeTextEditorSelection(() => {
      this.sendActiveContext();
    });
  }

  public sendActiveContext() {
    if (!this._view) return;
    const ctx = ContextManager.getActiveEditorContext();
    this._view.webview.postMessage({
      command: 'activeContextChanged',
      context: ctx
    });
  }

  public async sendInitialState() {
    if (!this._view) return;
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    const isConfigured = await this.ilmuClient.isConfigured();
    const isSignedIn = await this.authService.isSignedIn();
    const accountEmail = await this.authService.getAccountEmail();
    const currentModel = config.get<string>('model', 'ilmu-glm-5.3');
    const preferredLanguage = config.get<string>('preferredLanguage', 'English');
    const apiKey = await this.authService.getStoredToken() || '';
    const cloudRunnerUrl = config.get<string>('cloudRunnerUrl', 'http://localhost:4000');
    const ctx = ContextManager.getActiveEditorContext();
    const usageBreakdown = this.usageTracker.getBreakdown();

    this._view.webview.postMessage({
      command: 'initialState',
      isConfigured,
      isSignedIn,
      accountEmail,
      currentModel,
      preferredLanguage,
      apiKey: apiKey ? 'sk-••••••••' : '',
      rawApiKey: apiKey,
      cloudRunnerUrl,
      context: ctx,
      usage: usageBreakdown
    });

    this.refreshCloudTasks();
  }

  private async handleUserMessage(prompt: string, model: string) {
    if (!this._view) return;

    this._view.webview.postMessage({
      command: 'turnStarted',
      prompt
    });

    await this.agentLoop.runTurn(prompt, model, {
      onToken: (token) => {
        this._view?.webview.postMessage({ command: 'streamToken', token });
      },
      onReasoning: (reasoning) => {
        this._view?.webview.postMessage({ command: 'streamReasoning', reasoning });
      },
      onToolStart: (toolName, args) => {
        this._view?.webview.postMessage({ command: 'toolStart', toolName, args });
      },
      onToolResult: (toolName, output) => {
        this._view?.webview.postMessage({ command: 'toolResult', toolName, output });
      },
      onConfirmRequest: async (description: string) => {
        return new Promise<boolean>((resolve) => {
          this.pendingConfirmationResolver = resolve;
          this._view?.webview.postMessage({
            command: 'requestConfirmation',
            description
          });
        });
      },
      onError: (errMsg) => {
        this._view?.webview.postMessage({ command: 'turnError', error: errMsg });
      },
      onDone: () => {
        const usage = this.usageTracker.getBreakdown();
        this._view?.webview.postMessage({ command: 'turnDone', usage });
      }
    });
  }

  private async handleCloudTaskDelegation(title: string, prompt: string, model: string) {
    try {
      this._view?.webview.postMessage({ command: 'cloudTaskSubmitting' });
      const task = await this.cloudClient.submitTask({
        title,
        prompt,
        model
      });

      vscode.window.showInformationMessage(`Task delegated to ILMU Cloud: "${title}"`);
      await this.refreshCloudTasks();

      // Start streaming logs in background
      this.cloudClient.streamTask(
        task.id,
        (updatedTask) => {
          this._view?.webview.postMessage({
            command: 'cloudTaskUpdated',
            task: updatedTask
          });
        },
        (logLine) => {
          this._view?.webview.postMessage({
            command: 'cloudTaskLog',
            taskId: task.id,
            log: logLine
          });
        },
        (err) => {
          this._view?.webview.postMessage({
            command: 'cloudTaskError',
            taskId: task.id,
            error: err
          });
        }
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Cloud delegation failed: ${err.message}`);
      this._view?.webview.postMessage({
        command: 'cloudTaskSubmitError',
        error: err.message
      });
    }
  }

  private async refreshCloudTasks() {
    try {
      const tasks = await this.cloudClient.listTasks();
      this._view?.webview.postMessage({
        command: 'cloudTasksList',
        tasks
      });
    } catch {
      this._view?.webview.postMessage({
        command: 'cloudTasksList',
        tasks: [],
        runnerOffline: true
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const candidates = [
      path.join(this._extensionUri.fsPath, 'src', 'webview', 'media', 'sidebar.html'),
      path.join(this._extensionUri.fsPath, 'dist', 'webview', 'media', 'sidebar.html'),
      path.join(this._extensionUri.fsPath, 'media', 'sidebar.html'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
      }
    }

    return '<!DOCTYPE html><html><body><h3>ILMU Codex: sidebar.html not found</h3></body></html>';
  }
}
