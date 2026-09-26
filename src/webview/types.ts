import type { AgentSession } from "../agent/agentSession";

export type WebviewMessage =
  | { type: "SEND_PROMPT"; prompt: string; sessionId: string }
  | { type: "CANCEL_RUN"; sessionId: string }
  | { type: "NEW_SESSION"; workspacePath?: string }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "STOP_AGENT"; sessionId: string }
  | { type: "CONNECT_CURSOR"; apiKey?: string }
  | { type: "DISCONNECT_CURSOR" }
  | { type: "GET_AUTH_STATUS" }
  | { type: "OPEN_FILE"; path: string }
  | { type: "APPROVE_PERMISSION"; requestId: string }
  | { type: "DENY_PERMISSION"; requestId: string }
  | { type: "LIST_SESSIONS" };

export type AuthStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AuthStatusMessage {
  type: "AUTH_STATUS";
  status: AuthStatus;
  hasKey: boolean;
  error?: string;
  message?: string;
}

export type SessionListItem = Pick<AgentSession, "sessionId" | "status" | "workspacePath" | "currentTask">;

export type ExtensionMessage =
  | { type: "AGENT_STATE"; state: AgentState }
  | { type: "AGENT_MESSAGE"; message: string }
  | { type: "AGENT_THINKING"; message: string }
  | { type: "AGENT_TOOL_CALL"; toolCall: unknown }
  | { type: "AGENT_TOOL_RESULT"; result: unknown }
  | { type: "AGENT_ERROR"; error: string }
  | { type: "PERMISSION_REQUEST"; requestId: string; message: string }
  | { type: "SESSION_UPDATED"; sessions: SessionListItem[]; activeSessionId?: string }
  | AuthStatusMessage
  | { type: "SHOW_SETTINGS" }
  | { type: "RUN_STARTED"; runId: string }
  | { type: "RUN_COMPLETED"; runId: string };

export type AgentState = "idle" | "starting" | "ready" | "running" | "completed" | "failed" | "cancelled" | "disconnected";

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === "object" && value !== null && "type" in value && typeof (value as { type: unknown }).type === "string";
}
