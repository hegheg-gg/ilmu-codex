import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export class AuthService {
  private static readonly SECRET_KEY = 'ilmu_codex_api_token';
  private static readonly ACCOUNT_INFO_KEY = 'ilmu_codex_account_info';

  private secrets: vscode.SecretStorage;
  private onAuthChangedEmitter = new vscode.EventEmitter<boolean>();
  public readonly onAuthChanged = this.onAuthChangedEmitter.event;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  /**
   * Reverse-engineer local ILMUcode desktop session & credentials
   */
  public async detectIlmuCodeDesktopSession(): Promise<{ apiKey: string; email?: string; source: string } | undefined> {
    try {
      const home = os.homedir();
      const possibleDirs = [
        path.join(home, '.ilmucode', 'v2'),
        path.join(home, '.ilmucode'),
        path.join(home, '.ilmu', 'cli')
      ];

      for (const dir of possibleDirs) {
        const configFile = path.join(dir, 'config.json');
        if (fs.existsSync(configFile)) {
          const content = await fs.promises.readFile(configFile, 'utf-8');
          const parsed = JSON.parse(content);

          const apiKey =
            parsed?.provider?.['builtin:ilmu']?.options?.apiKey ||
            parsed?.provider?.['ilmu']?.options?.apiKey ||
            parsed?.options?.apiKey ||
            parsed?.apiKey;

          if (apiKey && typeof apiKey === 'string' && apiKey.startsWith('sk-')) {
            // Check for user/email info in bot-state or telemetry
            let email: string | undefined = undefined;
            const botStateFile = path.join(dir, 'bot-state.v2.json');
            if (fs.existsSync(botStateFile)) {
              try {
                const botContent = await fs.promises.readFile(botStateFile, 'utf-8');
                const botParsed = JSON.parse(botContent);
                email = botParsed?.user?.email || botParsed?.account?.email || botParsed?.email;
              } catch {}
            }

            return {
              apiKey,
              email: email || 'ILMUcode Desktop (Active Session)',
              source: configFile
            };
          }
        }
      }
    } catch {
      // Ignore reading errors
    }
    return undefined;
  }

  public async detectIlmuCodeDesktopKey(): Promise<string | undefined> {
    const session = await this.detectIlmuCodeDesktopSession();
    return session?.apiKey;
  }

  /**
   * Check if user is currently signed in via OAuth or stored token
   */
  public async getStoredToken(): Promise<string | undefined> {
    // 1. Check SecretStorage
    const secretToken = await this.secrets.get(AuthService.SECRET_KEY);
    if (secretToken && secretToken.trim().length > 0) return secretToken.trim();

    // 2. Check VS Code settings
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    const configKey = config.get<string>('apiKey');
    if (configKey && configKey.trim()) return configKey.trim();

    // 3. Check environment variable
    if (process.env.ILMU_API_KEY && process.env.ILMU_API_KEY.trim()) {
      return process.env.ILMU_API_KEY.trim();
    }

    // 4. Check local ILMUcode desktop session
    const desktopKey = await this.detectIlmuCodeDesktopKey();
    if (desktopKey) {
      // Auto-cache into secret storage for seamless future sessions
      await this.setToken(desktopKey, 'ILMUcode Desktop Account');
      return desktopKey;
    }

    return undefined;
  }

  public async getAccountEmail(): Promise<string | undefined> {
    return await this.secrets.get(AuthService.ACCOUNT_INFO_KEY);
  }

  public async isSignedIn(): Promise<boolean> {
    const token = await this.getStoredToken();
    return Boolean(token && token.length > 0);
  }

  public async setToken(token: string, email?: string): Promise<void> {
    await this.secrets.store(AuthService.SECRET_KEY, token);
    if (email) {
      await this.secrets.store(AuthService.ACCOUNT_INFO_KEY, email);
    }
    this.onAuthChangedEmitter.fire(true);
  }

  public async signOut(): Promise<void> {
    await this.secrets.delete(AuthService.SECRET_KEY);
    await this.secrets.delete(AuthService.ACCOUNT_INFO_KEY);

    // Also clear from vscode config if present
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    if (config.get<string>('apiKey')) {
      await config.update('apiKey', '', vscode.ConfigurationTarget.Global);
    }

    this.onAuthChangedEmitter.fire(false);
  }

  /**
   * Connect flow: Auto-imports from local ILMUcode desktop session if available,
   * or opens ILMU Console dashboard/keys in browser.
   */
  public async startWebOAuthFlow(): Promise<{ token: string; email?: string }> {
    // 1. First check if user is already signed in on ILMUcode desktop
    const session = await this.detectIlmuCodeDesktopSession();
    if (session) {
      await this.setToken(session.apiKey, session.email);
      vscode.window.showInformationMessage(`Successfully connected via ILMUcode session (${session.email})!`);
      return { token: session.apiKey, email: session.email };
    }

    // 2. Open ILMU Console API Keys page in browser
    const keysUrl = 'https://console.ilmu.ai/dashboard/keys';
    vscode.window.showInformationMessage(
      'Opening ILMU Console in your browser. Copy your API key (starts with sk-)...',
      'Open Console'
    ).then(choice => {
      if (choice === 'Open Console') {
        vscode.env.openExternal(vscode.Uri.parse(keysUrl));
      }
    });

    await vscode.env.openExternal(vscode.Uri.parse(keysUrl));

    // Prompt user to paste their sk- key
    const input = await vscode.window.showInputBox({
      prompt: 'Paste your ILMU API Key (sk-...) from the Console',
      placeHolder: 'sk-...',
      password: true,
      ignoreFocusOut: true,
      validateInput: (val) => {
        if (!val || !val.trim().startsWith('sk-')) {
          return 'ILMU API key must start with "sk-"';
        }
        return null;
      }
    });

    if (!input) {
      throw new Error('Sign in cancelled: No API key was entered.');
    }

    const trimmedKey = input.trim();
    await this.setToken(trimmedKey, 'ILMU Console User');
    return { token: trimmedKey, email: 'ILMU Console User' };
  }

  /**
   * Handle URI callback if user logs in via custom protocol vscode:// or antigravity://
   */
  public async handleUriCallback(uri: vscode.Uri) {
    const params = new URLSearchParams(uri.query);
    const token = params.get('token') || params.get('key');
    const email = params.get('email') || undefined;

    if (token) {
      await this.setToken(token, email);
      vscode.window.showInformationMessage('Successfully signed in to ILMU Codex!');
    }
  }
}
