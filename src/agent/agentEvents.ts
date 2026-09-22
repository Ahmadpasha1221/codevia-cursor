import type { PermissionRequest } from "../permissions/permissionTypes";

export type AgentEvent =
  | { type: "agent_started"; sessionId: string; timestamp: number }
  | { type: "agent_thinking"; sessionId: string; message: string; timestamp: number }
  | { type: "assistant_message"; sessionId: string; message: string; timestamp: number }
  | { type: "tool_started"; sessionId: string; toolName: string; timestamp: number }
  | { type: "tool_finished"; sessionId: string; toolName: string; timestamp: number }
  | { type: "file_changed"; sessionId: string; path: string; timestamp: number }
  | { type: "command_started"; sessionId: string; command: string; timestamp: number }
  | { type: "command_finished"; sessionId: string; command: string; timestamp: number }
  | { type: "permission_required"; sessionId: string; requestId: string; message: string; timestamp: number }
  | { type: "agent_permission"; sessionId: string; request: PermissionRequest }
  | { type: "agent_disconnected"; sessionId: string; timestamp: number }
  | { type: "agent_completed"; sessionId: string; timestamp: number }
  | { type: "agent_cancelled"; sessionId: string; timestamp: number }
  | { type: "agent_error"; sessionId: string; error: string; category: string; timestamp: number };
