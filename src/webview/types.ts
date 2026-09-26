import type { AgentSession } from "../agent/agentSession";

export type WebviewMessage =
  | { type: "SEND_PROMPT"; prompt: string; sessionId: string }
  | { type: "CANCEL_RUN"; sessionId: string }
  | { type: "NEW_SESSION"; workspacePath?: string }
  | { type: "SELECT_SESSION"; sessionId: string }
  | { type: "STOP_AGENT"; sessionId: string }
  | { type: "CONNECT_CURSOR" }
  | { type: "DISCONNECT_CURSOR" }
  | { type: "OPEN_FILE"; path: string }
  | { type: "APPROVE_PERMISSION"; requestId: string }
  | { type: "DENY_PERMISSION"; requestId: string }
  | { type: "LIST_SESSIONS" };

export type ExtensionMessage =
  | { type: "AGENT_STATE"; state: AgentState }
  | { type: "AGENT_MESSAGE"; message: string }
  | { type: "AGENT_THINKING"; message: string }
  | { type: "AGENT_TOOL_CALL"; toolCall: unknown }
  | { type: "AGENT_TOOL_RESULT"; result: unknown }
  | { type: "AGENT_ERROR"; error: string }
  | { type: "PERMISSION_REQUEST"; requestId: string; message: string }
  | { type: "SESSION_UPDATED"; sessions: AgentSession[] }
  | { type: "AUTH_STATUS"; status: string }
  | { type: "RUN_STARTED"; runId: string }
  | { type: "RUN_COMPLETED"; runId: string };

export type AgentState = "idle" | "starting" | "ready" | "running" | "completed" | "failed" | "cancelled" | "disconnected";
