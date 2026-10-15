import * as vscode from 'vscode';
import { IlmuClient } from './ilmuClient';
import { CloudDelegationClient } from './cloud/cloudDelegation';
import { IlmuWebviewProvider } from './webview/IlmuWebviewProvider';
import { AuthService } from './auth/authService';
import { IlmuInlineCompletionItemProvider } from './inlineCompletion';
import { UsageTracker } from './usageTracker';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const usageTracker = new UsageTracker(context.globalState);
  const authService = new AuthService(context.secrets);
  const ilmuClient = new IlmuClient(authService, usageTracker);
  const cloudClient = new CloudDelegationClient();

  // Register Web OAuth URI Handler for vscode:// or antigravity:// deep links
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        authService.handleUriCallback(uri);
      }
    })
  );

  // Create and register Webview Sidebar Provider
  const sidebarProvider = new IlmuWebviewProvider(
    context.extensionUri,
    ilmuClient,
    cloudClient,
    authService,
    usageTracker
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      IlmuWebviewProvider.viewType,
      sidebarProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  // Register Inline Completion Provider (Ghost text / Tab Autocomplete)
  const inlineProvider = new IlmuInlineCompletionItemProvider(ilmuClient);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      inlineProvider
    )
  );

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'ilmuCodex.openSidebar';
  updateStatusBar(authService);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Update status bar when auth changes
  authService.onAuthChanged(() => {
    updateStatusBar(authService);
    sidebarProvider.sendInitialState();
  });

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ilmuCodex.openSidebar', async () => {
      await vscode.commands.executeCommand('ilmuCodex.sidebar.focus');
    }),

    vscode.commands.registerCommand('ilmuCodex.signIn', async () => {
      try {
        await authService.startWebOAuthFlow();
        vscode.window.showInformationMessage('Successfully signed in to ILMU Codex!');
      } catch (err: any) {
        vscode.window.showErrorMessage(`Sign in failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('ilmuCodex.signOut', async () => {
      await authService.signOut();
      vscode.window.showInformationMessage('Signed out of ILMU Codex.');
    }),

    vscode.commands.registerCommand('ilmuCodex.newChat', async () => {
      await vscode.commands.executeCommand('ilmuCodex.sidebar.focus');
      vscode.window.showInformationMessage('Starting new ILMU Codex conversation');
    }),

    vscode.commands.registerCommand('ilmuCodex.delegateTask', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Enter title for Cloud Delegated Task',
        placeHolder: 'e.g. Generate database migration and repository layer'
      });
      if (!title) return;

      const prompt = await vscode.window.showInputBox({
        prompt: 'Describe the complete task instruction for the Cloud Runner',
        placeHolder: 'Detailed instructions...'
      });
      if (!prompt) return;

      try {
        const task = await cloudClient.submitTask({ title, prompt });
        vscode.window.showInformationMessage(`Task "${task.title}" successfully delegated to Cloud!`);
        await vscode.commands.executeCommand('ilmuCodex.sidebar.focus');
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to delegate task: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('ilmuCodex.explainSelectedCode', async () => {
      await vscode.commands.executeCommand('ilmuCodex.sidebar.focus');
    }),

    vscode.commands.registerCommand('ilmuCodex.refactorSelectedCode', async () => {
      await vscode.commands.executeCommand('ilmuCodex.sidebar.focus');
    }),

    vscode.commands.registerCommand('ilmuCodex.generateTests', async () => {
      await vscode.commands.executeCommand('ilmuCodex.sidebar.focus');
    }),

    vscode.commands.registerCommand('ilmuCodex.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'ilmuCodex');
    })
  );

  // Watch configuration updates
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ilmuCodex')) {
        ilmuClient.refreshConfig();
        cloudClient.refreshConfig();
        sidebarProvider.sendInitialState();
        updateStatusBar(authService);
      }
    })
  );
}

async function updateStatusBar(authService: AuthService) {
  const config = vscode.workspace.getConfiguration('ilmuCodex');
  const model = config.get<string>('model', 'ilmu-glm-5.3');
  const signedIn = await authService.isSignedIn();
  const email = await authService.getAccountEmail();

  if (!signedIn) {
    statusBarItem.text = `$(sign-in) ILMU Codex (Sign in)`;
    statusBarItem.tooltip = 'Click to open ILMU Codex and sign in via Web OAuth';
  } else {
    statusBarItem.text = `$(sparkle) ILMU Codex (${model})`;
    statusBarItem.tooltip = `ILMU Codex signed in${email ? ' as ' + email : ''} (${model}). Click to open sidebar.`;
  }
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
