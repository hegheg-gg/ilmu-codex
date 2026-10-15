import * as vscode from 'vscode';
import * as path from 'path';

export interface EditorContext {
  activeFilePath?: string;
  activeFileRelative?: string;
  fileLanguage?: string;
  selectedText?: string;
  cursorLine?: number;
  totalLines?: number;
  workspaceName?: string;
}

export class ContextManager {
  public static getActiveEditorContext(): EditorContext {
    const editor = vscode.window.activeTextEditor;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : '';

    if (!editor) {
      return {
        workspaceName: workspaceFolder?.name || 'No workspace open'
      };
    }

    const doc = editor.document;
    const fsPath = doc.uri.fsPath;
    const relPath = workspaceRoot ? path.relative(workspaceRoot, fsPath) : fsPath;
    const selection = editor.selection;
    const selectedText = !selection.isEmpty ? doc.getText(selection) : undefined;

    return {
      activeFilePath: fsPath,
      activeFileRelative: relPath,
      fileLanguage: doc.languageId,
      selectedText,
      cursorLine: selection.active.line + 1,
      totalLines: doc.lineCount,
      workspaceName: workspaceFolder?.name || ''
    };
  }

  public static formatContextPrompt(ctx: EditorContext): string {
    const parts: string[] = [];

    if (ctx.workspaceName) {
      parts.push(`Current Workspace: ${ctx.workspaceName}`);
    }

    if (ctx.activeFileRelative) {
      parts.push(`Active File: ${ctx.activeFileRelative} (${ctx.fileLanguage || 'plain text'}, ${ctx.totalLines} lines)`);
    }

    if (ctx.selectedText) {
      parts.push(`User Selected Code (line ${ctx.cursorLine}):\n\`\`\`${ctx.fileLanguage || ''}\n${ctx.selectedText}\n\`\`\``);
    }

    return parts.join('\n');
  }
}
