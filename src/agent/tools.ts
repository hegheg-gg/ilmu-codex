import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ToolDefinition } from '../ilmuClient';
import { DiffViewer } from '../diff/diffViewer';

export interface ToolExecutionContext {
  workspaceRoot: string;
  onConfirmAction?: (actionDescription: string) => Promise<boolean>;
  onLog?: (msg: string) => void;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative or absolute file path to read'
          },
          startLine: {
            type: 'number',
            description: 'Optional 1-based start line number'
          },
          endLine: {
            type: 'number',
            description: 'Optional 1-based end line number'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with full contents.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative or absolute file path to write'
          },
          content: {
            type: 'string',
            description: 'The exact complete text content to write into the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_diff',
      description: 'Replace a specific block of text in an existing file with new text.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path of the file to modify'
          },
          searchContent: {
            type: 'string',
            description: 'The exact block of code currently in the file to be replaced'
          },
          replaceContent: {
            type: 'string',
            description: 'The new block of code to replace it with'
          }
        },
        required: ['path', 'searchContent', 'replaceContent']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and subdirectories inside a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to workspace or absolute. Use "." for root'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for text or regex across workspace files.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search string or pattern'
          },
          filePattern: {
            type: 'string',
            description: 'Optional glob pattern to restrict search (e.g. "*.ts", "src/**")'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a terminal command in the workspace directory (build, test, git, etc).',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command line to execute'
          }
        },
        required: ['command']
      }
    }
  }
];

export async function executeAgentTool(
  toolName: string,
  args: Record<string, any>,
  context: ToolExecutionContext
): Promise<string> {
  const resolvePath = (p: string) => {
    if (path.isAbsolute(p)) return p;
    return path.join(context.workspaceRoot, p);
  };

  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = resolvePath(args.path);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${args.path}`;
        }
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const lines = fileContent.split(/\r?\n/);

        let start = 1;
        let end = lines.length;
        if (args.startLine && typeof args.startLine === 'number') {
          start = Math.max(1, args.startLine);
        }
        if (args.endLine && typeof args.endLine === 'number') {
          end = Math.min(lines.length, args.endLine);
        }

        const sliced = lines.slice(start - 1, end);
        const formatted = sliced.map((line, idx) => `${start + idx}: ${line}`).join('\n');
        return `File: ${args.path} (lines ${start}-${end} of ${lines.length}):\n${formatted}`;
      }

      case 'write_file': {
        const filePath = resolvePath(args.path);
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });

        const exists = fs.existsSync(filePath);
        const original = exists ? await fs.promises.readFile(filePath, 'utf-8') : '';

        // If file exists and differs, show side-by-side diff
        if (exists && original !== args.content) {
          const accepted = await DiffViewer.showSideBySideDiff(
            filePath,
            original,
            args.content,
            'Proposed write_file changes'
          );
          if (!accepted) {
            return `File write rejected by user after diff review: ${args.path}`;
          }
        } else if (!exists && context.onConfirmAction) {
          const approved = await context.onConfirmAction(`Create new file: ${args.path}`);
          if (!approved) {
            return `File creation rejected by user.`;
          }
        }

        await fs.promises.writeFile(filePath, args.content, 'utf-8');
        return `Successfully wrote ${args.content.length} characters to ${args.path}`;
      }

      case 'apply_diff': {
        const filePath = resolvePath(args.path);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${args.path}`;
        }
        let original = await fs.promises.readFile(filePath, 'utf-8');

        // Normalize line endings for replacement
        const normOriginal = original.replace(/\r\n/g, '\n');
        const normSearch = args.searchContent.replace(/\r\n/g, '\n');
        const normReplace = args.replaceContent.replace(/\r\n/g, '\n');

        if (!normOriginal.includes(normSearch)) {
          return `Error: searchContent could not be found in ${args.path}. Ensure the block matches exactly.`;
        }

        const updated = normOriginal.replace(normSearch, normReplace);

        // Show side-by-side diff before applying
        const accepted = await DiffViewer.showSideBySideDiff(
          filePath,
          normOriginal,
          updated,
          'Proposed apply_diff patch'
        );

        if (!accepted) {
          return `Patch application rejected by user after diff review: ${args.path}`;
        }

        await fs.promises.writeFile(filePath, updated, 'utf-8');
        return `Successfully applied patch to ${args.path}`;
      }

      case 'list_dir': {
        const targetPath = resolvePath(args.path || '.');
        if (!fs.existsSync(targetPath)) {
          return `Error: Directory not found: ${args.path}`;
        }
        const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
        const list = entries.map(entry => {
          const isDir = entry.isDirectory();
          return `${isDir ? '[DIR] ' : '[FILE]'} ${entry.name}`;
        });
        return `Contents of ${args.path || '.'}:\n${list.join('\n')}`;
      }

      case 'grep_search': {
        const results = await vscode.workspace.findFiles(
          args.filePattern || '**/*',
          '**/node_modules/**'
        );
        const matches: string[] = [];
        const regex = new RegExp(args.query, 'i');

        for (const file of results.slice(0, 100)) {
          try {
            const content = await fs.promises.readFile(file.fsPath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, index) => {
              if (regex.test(line)) {
                const rel = path.relative(context.workspaceRoot, file.fsPath);
                matches.push(`${rel}:${index + 1}: ${line.trim()}`);
              }
            });
            if (matches.length >= 50) break;
          } catch {
            // Ignore unreadable binary files
          }
        }

        if (matches.length === 0) {
          return `No matches found for "${args.query}"`;
        }
        return `Found ${matches.length} matches:\n${matches.slice(0, 50).join('\n')}`;
      }

      case 'run_command': {
        if (context.onConfirmAction) {
          const approved = await context.onConfirmAction(`Execute command: ${args.command}`);
          if (!approved) {
            return `Command execution rejected by user.`;
          }
        }

        return new Promise<string>((resolve) => {
          const cp = require('child_process');
          cp.exec(
            args.command,
            { cwd: context.workspaceRoot, maxBuffer: 1024 * 1024 * 5, timeout: 30000 },
            (err: any, stdout: string, stderr: string) => {
              let out = '';
              if (stdout) out += stdout;
              if (stderr) out += `\n[stderr]: ${stderr}`;
              if (err) out += `\n[exit error]: ${err.message}`;
              resolve(out.trim() || '(Command produced no output)');
            }
          );
        });
      }

      default:
        return `Unknown tool name: ${toolName}`;
    }
  } catch (err: any) {
    return `Error executing tool ${toolName}: ${err.message}`;
  }
}
