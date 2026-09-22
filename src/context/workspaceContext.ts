import type * as vscode from "vscode";
import { WorkspaceContext, WorkspaceFolderContext } from "./contextTypes";

export const DEFAULT_MAX_WORKSPACE_FOLDERS = 10;

export function collectWorkspaceContext(
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
  isTrusted: boolean,
  maxWorkspaceFolders = DEFAULT_MAX_WORKSPACE_FOLDERS,
): WorkspaceContext {
  const allFolders = workspaceFolders ?? [];
  const folders: WorkspaceFolderContext[] = allFolders
    .slice(0, Math.max(0, Math.floor(maxWorkspaceFolders)))
    .map((folder) => ({
      name: folder.name,
      path: folder.uri.fsPath || folder.uri.toString(),
    }));

  return {
    folders,
    rootPath: folders.length === 1 ? folders[0].path : undefined,
    isTrusted,
    foldersTruncated: allFolders.length > folders.length,
  };
}
