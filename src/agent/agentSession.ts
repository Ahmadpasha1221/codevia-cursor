export type AgentStatus =
  | "IDLE"
  | "STARTING"
  | "READY"
  | "RUNNING"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "DISCONNECTED";

export interface AgentErrorInfo {
  message: string;
  category: string;
}

export interface AgentSession {
  readonly sessionId: string;
  agentId?: string;
  runId?: string;
  workspacePath: string;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
  currentTask?: string;
  error?: AgentErrorInfo;
}
