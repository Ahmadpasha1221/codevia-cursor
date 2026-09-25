import type { FileChangeSummary } from "../runtime/runtimeTypes";
import type { AgentSession } from "../agent/agentSession";

export type GuiRuntimeProvider = "cursor" | "local" | "mock";
export type LocalProvider = "ollama" | "openai-compatible";

export type WebviewMessage =
  | { type: "SEND_PROMPT"; prompt: string; sessionId: string }
  | { type: "GET_TRANSCRIPT"; sessionId: string }
  | { type: "CANCEL_RUN"; sessionId: string }
  | { type: "NEW_SESSION"; workspacePath?: string }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "STOP_AGENT"; sessionId: string }
  | { type: "CONNECT_CURSOR"; apiKey?: string }
  | { type: "DISCONNECT_CURSOR" }
  | { type: "GET_AUTH_STATUS" }
  | { type: "GET_RUNTIME_STATUS" }
  | { type: "SELECT_RUNTIME"; provider: GuiRuntimeProvider; modelId?: string }
  | { type: "DISCOVER_LOCAL_MODELS"; provider?: LocalProvider }
  | { type: "CONNECT_LOCAL"; provider: LocalProvider; baseUrl?: string; apiKey?: string; modelId?: string }
  | { type: "SELECT_LOCAL_MODEL"; modelId: string }
  | { type: "USE_MOCK_RUNTIME" }
  | { type: "OPEN_FILE"; path: string }
  | { type: "OPEN_DIFF"; changeId: string }
  | { type: "RESOLVE_FILE_CHANGE"; changeId: string; decision: "ACCEPT" | "REJECT" }
  | { type: "APPROVE_PERMISSION"; requestId: string }
  | { type: "DENY_PERMISSION"; requestId: string }
  | { type: "TRY_AGAIN"; sessionId: string }
  | { type: "LIST_SESSIONS" };

export type AuthStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AuthStatusMessage {
  type: "AUTH_STATUS";
  status: AuthStatus;
  hasKey: boolean;
  error?: string;
  message?: string;
}

export interface LocalModelInfo {
  id: string;
  name: string;
  provider: LocalProvider;
}

export type SessionListItem = Pick<AgentSession, "sessionId" | "status" | "workspacePath" | "currentTask">;

export interface FileChangeView {
  changeId: string;
  toolName: string;
  path: string;
  status: "APPLIED" | "REVERTED" | "MISSING";
  additions: number;
  deletions: number;
  isNewFile: boolean;
}

export type ExtensionMessage =
  | { type: "AGENT_STATE"; state: AgentState }
  | { type: "AGENT_MESSAGE"; message: string }
  | { type: "AGENT_TEXT_DELTA"; sessionId: string; text: string }
  | { type: "AGENT_USAGE"; promptTokens: number; completionTokens: number; totalTokens: number; costUsd?: number }
  | { type: "FILE_CHANGE"; change: FileChangeView }
  | { type: "FILE_CHANGE_REVERTED"; change: FileChangeView }
  | { type: "AGENT_THINKING"; message: string }
  | { type: "AGENT_TOOL_CALL"; toolCall: { toolName?: string; command?: string; path?: string } }
  | { type: "AGENT_TOOL_RESULT"; result: { toolName?: string; error?: string } }
  | { type: "AGENT_COMMAND_OUTPUT"; command: string; cwd?: string; stdout: string; stderr: string; exitCode: number | null }
  | { type: "AGENT_ERROR"; error: string }
  | { type: "PERMISSION_REQUEST"; requestId: string; message: string; command?: string; category?: string; destructive?: boolean }
  | { type: "SESSION_UPDATED"; sessions: SessionListItem[]; activeSessionId?: string }
  | AuthStatusMessage
  | {
      type: "RUNTIME_STATUS";
      provider: GuiRuntimeProvider;
      connected: boolean;
      modelId?: string;
      modelName?: string;
      localProvider?: LocalProvider;
      error?: string;
    }
  | { type: "LOCAL_MODELS"; provider: LocalProvider; models: LocalModelInfo[]; error?: string }
  | { type: "SHOW_SETTINGS" }
  | { type: "RUN_STARTED"; runId: string }
  | { type: "RUN_COMPLETED"; runId: string }
  | {
      type: "TRANSCRIPT";
      sessionId: string;
      entries: Array<{
        kind: "user" | "assistant" | "thinking" | "tool" | "command" | "error" | "system";
        text: string;
        timestamp: number;
        toolName?: string;
        command?: string;
        path?: string;
        stdout?: string;
        stderr?: string;
        exitCode?: number | null;
        error?: string;
      }>;
    };

export type AgentState = "idle" | "starting" | "ready" | "running" | "completed" | "failed" | "cancelled" | "disconnected";

export type { FileChangeSummary };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === "object" && value !== null && "type" in value && typeof (value as { type: unknown }).type === "string";
}
