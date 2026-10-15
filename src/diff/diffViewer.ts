import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export class DiffViewer {
  /**
   * Opens side-by-side diff comparing original file against proposed changes.
   * Can optionally prompt the user to Accept or Discard the changes.
   */
  public static async showSideBySideDiff(
    filePath: string,
    originalContent: string,
    newContent: string,
    title: string = 'ILMU Proposed Changes',
    requestConfirmation: boolean = true
  ): Promise<boolean> {
    const tmpDir = os.tmpdir();
    const baseName = path.basename(filePath);
    const originalFileUri = vscode.Uri.file(
      path.join(tmpDir, `ilmu_current_${Date.now()}_${baseName}`)
    );
    const proposedFileUri = vscode.Uri.file(
      path.join(tmpDir, `ilmu_proposed_${Date.now()}_${baseName}`)
    );

    await fs.promises.writeFile(originalFileUri.fsPath, originalContent, 'utf-8');
    await fs.promises.writeFile(proposedFileUri.fsPath, newContent, 'utf-8');

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalFileUri,
      proposedFileUri,
      `${baseName} (Current ↔ Proposed)`
    );

    if (!requestConfirmation) {
      return true;
    }

    const choice = await vscode.window.showInformationMessage(
      `Review changes for "${baseName}": Would you like to accept these changes?`,
      { modal: false },
      'Accept Changes',
      'Discard'
    );

    // Clean up temporary files
    try {
      if (fs.existsSync(originalFileUri.fsPath)) await fs.promises.unlink(originalFileUri.fsPath);
      if (fs.existsSync(proposedFileUri.fsPath)) await fs.promises.unlink(proposedFileUri.fsPath);
    } catch {}

    return choice === 'Accept Changes';
  }
}
