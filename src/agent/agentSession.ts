import type { RuntimeProvider } from "../runtime/runtimeTypes";

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
  readonly provider: RuntimeProvider;
  readonly modelId?: string;
  readonly providerSessionId?: string;
  agentId?: string;
  runId?: string;
  workspacePath: string;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
  currentTask?: string;
  error?: AgentErrorInfo;
}
