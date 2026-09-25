import * as vscode from "vscode";
import { COMMANDS, EXTENSION_NAME } from "./shared/constants";
import { Logger } from "./utils/logger";
import { CursorAuthProvider } from "./auth/cursorAuthProvider";
import { VSCodeSecretStorageAdapter } from "./auth/secretStorage";
import { CursorClient } from "./auth/cursorClient";
import { CursorConnectionService } from "./auth/cursorConnection";
import { AgentManager } from "./agent/agentManager";
import { SessionStore } from "./session/sessionStore";
import { TranscriptStore } from "./session/transcriptStore";
import { MessageRouter } from "./webview/messageRouter";
import { AgentViewProvider } from "./webview/agentViewProvider";
import { PermissionManager } from "./permissions/permissionManager";
import { createDefaultPermissionPolicy } from "./permissions/permissionPolicy";
import { RuntimeManager } from "./runtime/runtimeManager";
import { MockRuntime } from "./runtime/mock/mockRuntime";
import { OllamaRuntime } from "./runtime/ollama/ollamaRuntime";
import { OpenAICompatibleRuntime } from "./runtime/openaiCompatible/openaiCompatibleRuntime";
import { WorkspaceToolExecutor } from "./runtime/tools/workspaceToolExecutor";
import { DiffViewService } from "./runtime/review/diffView";

const logger = new Logger(EXTENSION_NAME, "INFO");

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.info("Extension activating", { operation: "activate" });

  const secretStorage = new VSCodeSecretStorageAdapter(context.secrets);
  const cursorClient = new CursorClient(undefined);
  const authProvider = new CursorAuthProvider(secretStorage);
  const getWorkspacePath = (): string => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ".";
  const connection = new CursorConnectionService(secretStorage, cursorClient, getWorkspacePath);

  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      "codeviaCursor",
      "Codevia Cursor",
      authProvider,
      { supportsMultipleAccounts: false },
    ),
  );

  const permissionManager = new PermissionManager(
    createDefaultPermissionPolicy({
      isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    }),
  );

  const sessionStore = new SessionStore(context.workspaceState);
  const transcriptStore = new TranscriptStore(context.globalStorageUri);
  const agentManager = new AgentManager(cursorClient, sessionStore, permissionManager, transcriptStore);
  const diffView = new DiffViewService();
  const runtimeManager = new RuntimeManager({
    sessionStore,
    permissionManager,
    runtimes: [new OllamaRuntime(), new OpenAICompatibleRuntime(), new MockRuntime()],
    logger,
    toolExecutor: new WorkspaceToolExecutor(),
    defaultWorkspacePath: getWorkspacePath(),
    transcriptStore,
    diffView,
  });
  const messageRouter = new MessageRouter(
    agentManager,
    getWorkspacePath(),
    connection,
    cursorClient,
    runtimeManager,
  );
  const agentViewProvider = new AgentViewProvider(
    context.extensionUri,
    agentManager,
    messageRouter,
    connection,
    runtimeManager,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codeviaCursor.agent", agentViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(permissionManager, agentManager, runtimeManager, diffView, agentViewProvider);

  await agentManager.restoreSessions();
  await runtimeManager.restoreSessions();

  const openAgentCommand = vscode.commands.registerCommand(COMMANDS.openAgent, async () => {
    logger.info("Open agent command invoked", { operation: "openAgent" });
    await vscode.commands.executeCommand("workbench.view.extension.codeviaCursor.agent");
  });

  const openSettingsCommand = vscode.commands.registerCommand(COMMANDS.openSettings, async () => {
    logger.info("Open settings command invoked", { operation: "openSettings" });
    await vscode.commands.executeCommand("workbench.view.extension.codeviaCursor.agent");
    agentViewProvider.showSettings();
  });

  context.subscriptions.push(openAgentCommand, openSettingsCommand);

  logger.info("Extension activated", { operation: "activate" });
}

export function deactivate(): void {
  logger.info("Extension deactivating", { operation: "deactivate" });
}
