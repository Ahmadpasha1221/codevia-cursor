export type AuthStatus = "disconnected" | "connecting" | "connected" | "error";
export type RuntimeProvider = "cursor" | "local" | "mock";
export type LocalProvider = "ollama" | "openai-compatible";

export interface LocalModel {
  id: string;
  name: string;
  provider: LocalProvider;
  capabilities?: {
    streaming?: boolean;
    toolCalling?: boolean;
  };
}

export type GuiToHost =
  | { type: "SEND_PROMPT"; prompt: string; sessionId: string }
  | { type: "TRY_AGAIN"; sessionId: string }
  | { type: "CANCEL_RUN"; sessionId: string }
  | { type: "NEW_SESSION" }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "CONNECT_CURSOR"; apiKey?: string }
  | { type: "DISCONNECT_CURSOR" }
  | { type: "GET_AUTH_STATUS" }
  | { type: "LIST_SESSIONS" }
  | { type: "GET_RUNTIME_STATUS" }
  | { type: "SELECT_RUNTIME"; provider: RuntimeProvider; modelId?: string }
  | { type: "DISCOVER_LOCAL_MODELS"; provider?: LocalProvider }
  | { type: "CONNECT_LOCAL"; provider: LocalProvider; baseUrl?: string; apiKey?: string; modelId?: string }
  | { type: "SELECT_LOCAL_MODEL"; modelId: string }
  | { type: "USE_MOCK_RUNTIME" }
  | { type: "APPROVE_PERMISSION"; requestId: string }
  | { type: "DENY_PERMISSION"; requestId: string };

export interface SessionListItem {
  sessionId: string;
  status: string;
  workspacePath: string;
  currentTask?: string;
}

export type HostToGui =
  | { type: "AGENT_STATE"; state: string }
  | { type: "AGENT_MESSAGE"; message: string }
  | { type: "AGENT_THINKING"; message: string }
  | { type: "AGENT_TOOL_CALL"; toolCall: { toolName?: string; command?: string; path?: string } }
  | { type: "AGENT_TOOL_RESULT"; result: { toolName?: string; error?: string } }
  | { type: "AGENT_COMMAND_OUTPUT"; command: string; cwd?: string; stdout: string; stderr: string; exitCode: number | null }
  | { type: "AGENT_ERROR"; error: string }
  | { type: "PERMISSION_REQUEST"; requestId: string; message: string; command?: string; category?: string; destructive?: boolean }
  | { type: "SESSION_UPDATED"; sessions: SessionListItem[]; activeSessionId?: string }
  | { type: "AUTH_STATUS"; status: AuthStatus; hasKey: boolean; error?: string; message?: string }
  | { type: "RUNTIME_STATUS"; provider: RuntimeProvider; connected: boolean; modelId?: string; modelName?: string; localProvider?: LocalProvider; error?: string }
  | { type: "LOCAL_MODELS"; provider: LocalProvider; models: LocalModel[]; error?: string }
  | { type: "SHOW_SETTINGS" };
