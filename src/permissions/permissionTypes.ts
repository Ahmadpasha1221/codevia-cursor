export type PermissionCategory =
  | "READ"
  | "MODIFY"
  | "EXECUTE"
  | "EXTERNAL"
  | "DESTRUCTIVE";

export type PermissionDecision = "ALLOW" | "DENY";

export type PermissionResolutionStatus =
  | "allowed"
  | "denied"
  | "cancelled"
  | "timed_out";

export interface PermissionRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly category: PermissionCategory;
  readonly toolName?: string;
  readonly command?: string;
  readonly path?: string;
  readonly description: string;
  readonly destructive: boolean;
  readonly confirmation?: string;
}

export interface PermissionDecisionMessage {
  readonly requestId: string;
  readonly decision: PermissionDecision;
  readonly confirmation?: boolean;
}

export interface PermissionResolution {
  readonly requestId: string;
  readonly status: PermissionResolutionStatus;
  readonly timestamp: number;
}

export type PermissionEvent =
  | { type: "permission_requested"; request: PermissionRequest }
  | { type: "permission_resolved"; resolution: PermissionResolution }
  | { type: "permission_error"; requestId?: string; error: string };

export interface PendingPermissionRequest {
  readonly request: PermissionRequest;
  readonly resolve: (resolution: PermissionResolution) => void;
  readonly timeout?: ReturnType<typeof setTimeout>;
}