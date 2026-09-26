import * as vscode from "vscode";
import { collectDiagnosticsContext } from "./diagnosticsContext";
import { collectEditorContext } from "./editorContext";
import { collectWorkspaceContext } from "./workspaceContext";
import {
  ContextManagerOptions,
  ContextSnapshot,
  DEFAULT_MAX_DIAGNOSTICS,
  DEFAULT_MAX_DIAGNOSTIC_MESSAGE_LENGTH,
  DEFAULT_MAX_SELECTED_TEXT_LENGTH,
  DEFAULT_MAX_WORKSPACE_FOLDERS,
} from "./contextTypes";

export class ContextManager {
  private readonly maxWorkspaceFolders: number;
  private readonly maxDiagnostics: number;
  private readonly maxSelectedTextLength: number;
  private readonly maxDiagnosticMessageLength: number;

  constructor(options: ContextManagerOptions = {}) {
    this.maxWorkspaceFolders = Math.max(0, Math.floor(options.maxWorkspaceFolders ?? DEFAULT_MAX_WORKSPACE_FOLDERS));
    this.maxDiagnostics = Math.max(0, Math.floor(options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS));
    this.maxSelectedTextLength = Math.max(0, Math.floor(options.maxSelectedTextLength ?? DEFAULT_MAX_SELECTED_TEXT_LENGTH));
    this.maxDiagnosticMessageLength = Math.max(0, Math.floor(options.maxDiagnosticMessageLength ?? DEFAULT_MAX_DIAGNOSTIC_MESSAGE_LENGTH));
  }

  getCurrentContext(workspacePath?: string): ContextSnapshot {
    const isTrusted = vscode.workspace.isTrusted;
    const workspace = collectWorkspaceContext(
      vscode.workspace.workspaceFolders,
      isTrusted,
      this.maxWorkspaceFolders,
    );
    const editor = collectEditorContext(vscode.window.activeTextEditor, {
      maxSelectedTextLength: this.maxSelectedTextLength,
      includeSelectedText: isTrusted,
    });
    const diagnostics = isTrusted
      ? collectDiagnosticsContext(vscode.languages.getDiagnostics(), {
        maxDiagnostics: this.maxDiagnostics,
        maxDiagnosticMessageLength: this.maxDiagnosticMessageLength,
        workspaceFolders: workspace.folders,
        activeFilePath: editor?.filePath,
        workspacePath,
      })
      : [];

    return {
      workspace,
      ...(editor ? { editor } : {}),
      diagnostics,
    };
  }
}
