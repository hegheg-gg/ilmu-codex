import * as vscode from 'vscode';
import { IlmuClient } from './ilmuClient';

export class IlmuInlineCompletionItemProvider implements vscode.InlineCompletionItemProvider {
  private ilmuClient: IlmuClient;
  private debounceTimer?: NodeJS.Timeout;
  private abortController?: AbortController;

  constructor(ilmuClient: IlmuClient) {
    this.ilmuClient = ilmuClient;
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined> {
    const config = vscode.workspace.getConfiguration('ilmuCodex');
    const enabled = config.get<boolean>('enableInlineCompletion', true);
    if (!enabled) {
      return undefined;
    }

    const isConfigured = await this.ilmuClient.isConfigured();
    if (!isConfigured) {
      return undefined;
    }

    // Cancel any previous in-flight request
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    // Get prefix context (up to 40 lines before cursor)
    const startLine = Math.max(0, position.line - 40);
    const prefixRange = new vscode.Range(startLine, 0, position.line, position.character);
    const prefix = document.getText(prefixRange);

    // Get suffix context (up to 15 lines after cursor)
    const endLine = Math.min(document.lineCount - 1, position.line + 15);
    const suffixRange = new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).range.end.character);
    const suffix = document.getText(suffixRange);

    // Skip if cursor is on an empty line with no surrounding code
    if (!prefix.trim() && !suffix.trim()) {
      return undefined;
    }

    try {
      const languageId = document.languageId;
      const fileName = document.fileName.split(/[/\\]/).pop() || '';

      const completionPrompt = `You are an ultra-fast inline code completion engine for ${languageId} (file: ${fileName}).
Given the surrounding code prefix and suffix, return ONLY the exact code completion snippet to be inserted at the cursor position.
Do NOT output markdown blocks, backticks, comments, or explanations. Only the raw code text that continues the prefix.

<CodePrefix>
${prefix}
</CodePrefix>
<CodeSuffix>
${suffix}
</CodeSuffix>

Inline completion:`;

      const fastModel = config.get<string>('inlineCompletionModel', 'ilmu-glm-5.3-flash');

      // Call completion with small max_tokens and high speed
      let completedText = '';
      await this.ilmuClient.streamChat(
        fastModel,
        [
          { role: 'system', content: 'You are an inline code autocompleter. Output raw code only.' },
          { role: 'user', content: completionPrompt }
        ],
        [],
        {
          onToken: (t) => {
            completedText += t;
          }
        },
        this.abortController.signal
      );

      // Clean up any markdown code fence wrappers if model accidentally emitted them
      let cleaned = completedText.trimEnd();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '');
      }

      if (!cleaned || token.isCancellationRequested) {
        return undefined;
      }

      const item = new vscode.InlineCompletionItem(
        cleaned,
        new vscode.Range(position, position)
      );

      return [item];
    } catch {
      return undefined;
    }
  }
}
