import type { AuthStatus, FileChangeView, LocalModel, LocalProvider, RuntimeProvider, SessionListItem } from "./protocol";

export type AppView = "chat" | "settings";

export interface ChatLine {
  role: "user" | "agent" | "thinking" | "error" | "system";
  text: string;
  streaming?: boolean;
  permission?: {
    requestId: string;
    command?: string;
    pending: boolean;
    destructive?: boolean;
  };
  command?: {
    command: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    running?: boolean;
  };
  fileChange?: FileChangeView;
}

export interface AppState {
  view: AppView;
  provider: RuntimeProvider;
  localProvider: LocalProvider;
  selectedModelId?: string;
  selectedModelName?: string;
  localModels: LocalModel[];
  localLoading: boolean;
  runtimeConnected: boolean;
  runtimeError?: string;
  authStatus: AuthStatus;
  hasKey: boolean;
  authError?: string;
  authMessage?: string;
  connecting: boolean;
  running: boolean;
  sessions: SessionListItem[];
  activeSessionId?: string;
  messages: ChatLine[];
  lastPrompt?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd?: number };
  modelCapabilities?: { streaming: boolean; toolCalling: boolean; reasoning?: boolean };
}

export function createInitialState(): AppState {
  return {
    view: "chat",
    provider: "cursor",
    localProvider: "ollama",
    localModels: [],
    localLoading: false,
    runtimeConnected: false,
    authStatus: "disconnected",
    hasKey: false,
    connecting: false,
    running: false,
    sessions: [],
    messages: [],
  };
}
