import * as vscode from "vscode";

/**
 * Shows "agent change vs. current disk" in VS Code's native diff editor using
 * virtual documents, so no temp files are needed. The left side is the snapshot
 * from before the agent touched the file; the right side is the file as it is
 * on disk right now (or the agent's content if the file was created).
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = "codevia-diff";

  private readonly contents = new Map<string, string>();
  private readonly disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.workspace.registerTextDocumentContentProvider(DiffContentProvider.scheme, this);
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
  }

  clear(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  dispose(): void {
    this.disposable.dispose();
    this.contents.clear();
  }
}

export class DiffViewService implements vscode.Disposable {
  private readonly provider = new DiffContentProvider();
  private counter = 0;

  async showDiff(options: {
    readonly title: string;
    readonly beforeContent?: string;
    readonly beforeExists: boolean;
    readonly afterPath: string;
  }): Promise<void> {
    const beforeUri = this.virtualUri("before", options.beforeExists ? options.beforeContent ?? "" : "");
    const afterUri = vscode.Uri.file(options.afterPath);

    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeUri,
      afterUri,
      options.title,
      { preview: true },
    );
  }

  async showContent(options: {
    readonly title: string;
    readonly content: string;
    readonly fileName: string;
  }): Promise<void> {
    const uri = this.virtualUri("content", options.content);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private virtualUri(kind: "before" | "content", content: string): vscode.Uri {
    this.counter += 1;
    const uri = vscode.Uri.parse(`${DiffContentProvider.scheme}:/${kind}-${this.counter}.txt`);
    this.provider.setContent(uri, content);
    return uri;
  }

  dispose(): void {
    this.provider.dispose();
  }
}

export function diffTitle(toolName: string, relativePath: string, status: string): string {
  const badge = status === "REVERTED" ? "reverted" : status === "MISSING" ? "missing" : "applied";
  return `${toolName}: ${relativePath} (${badge}) — Original ⇄ Current`;
}
