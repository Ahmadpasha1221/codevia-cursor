import { AgentManager } from "../agent/agentManager";
import { AgentEvent } from "../agent/agentEvents";
import { ExtensionMessage, WebviewMessage } from "./types";

export class MessageRouter {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly defaultWorkspacePath = ".",
  ) {}

  async handleMessage(message: unknown): Promise<unknown> {
    const typed = this.validate(message);

    switch (typed.type) {
      case "SEND_PROMPT": {
        await this.agentManager.startTask(typed.sessionId, typed.prompt);
        return { success: true };
      }
      case "CANCEL_RUN":
      case "STOP_AGENT": {
        await this.agentManager.cancelTask(typed.sessionId);
        return { success: true };
      }
      case "NEW_SESSION": {
        const session = this.agentManager.createSession(typed.workspacePath ?? this.defaultWorkspacePath);
        return { success: true, session };
      }
      case "SELECT_SESSION": {
        const selected = this.agentManager.selectSession(typed.sessionId);
        return { success: true, selected };
      }
      case "LIST_SESSIONS": {
        return { success: true, sessions: this.agentManager.listSessions() };
      }
      case "OPEN_FILE":
      case "APPROVE_PERMISSION":
      case "DENY_PERMISSION":
      case "CONNECT_CURSOR":
      case "DISCONNECT_CURSOR": {
        return { success: true };
      }
      default: {
        const _exhaustive: never = typed;
        return _exhaustive;
      }
    }
  }

  toExtensionMessage(event: AgentEvent): ExtensionMessage | undefined {
    switch (event.type) {
      case "agent_started":
        return { type: "AGENT_STATE", state: "starting" };
      case "agent_thinking":
        return { type: "AGENT_THINKING", message: event.message };
      case "assistant_message":
        return { type: "AGENT_MESSAGE", message: event.message };
      case "tool_started":
        return { type: "AGENT_TOOL_CALL", toolCall: { toolName: event.toolName } };
      case "tool_finished":
        return { type: "AGENT_TOOL_RESULT", result: { toolName: event.toolName } };
      case "file_changed":
        return { type: "AGENT_MESSAGE", message: `File changed: ${event.path}` };
      case "command_started":
        return { type: "AGENT_MESSAGE", message: `Command started: ${event.command}` };
      case "command_finished":
        return { type: "AGENT_MESSAGE", message: `Command finished: ${event.command}` };
      case "permission_required":
        return { type: "PERMISSION_REQUEST", requestId: event.requestId, message: event.message };
      case "agent_completed":
        return { type: "AGENT_STATE", state: "completed" };
      case "agent_disconnected":
        return { type: "AGENT_STATE", state: "disconnected" };
      case "agent_cancelled":
        return { type: "AGENT_STATE", state: "cancelled" };
      case "agent_error":
        return { type: "AGENT_ERROR", error: event.error };
      default:
        return undefined;
    }
  }

  private validate(message: unknown): WebviewMessage {
    if (typeof message !== "object" || message === null) {
      throw new Error("Invalid message shape");
    }

    const typed = message as Record<string, unknown>;
    const type = typed.type;

    if (typeof type !== "string") {
      throw new Error("Missing message type");
    }

    switch (type) {
      case "SEND_PROMPT":
        if (typeof typed.prompt !== "string" || typeof typed.sessionId !== "string") {
          throw new Error("Invalid SEND_PROMPT message");
        }
        return message as WebviewMessage;
      case "CANCEL_RUN":
      case "STOP_AGENT":
      case "SELECT_SESSION":
        if (typeof typed.sessionId !== "string") {
          throw new Error(`Invalid ${type} message`);
        }
        return message as WebviewMessage;
      case "LIST_SESSIONS":
        return message as WebviewMessage;
      case "NEW_SESSION":
        if (
          typed.workspacePath !== undefined &&
          typeof typed.workspacePath !== "string"
        ) {
          throw new Error("Invalid NEW_SESSION message");
        }
        return message as WebviewMessage;
      case "OPEN_FILE":
        if (typeof typed.path !== "string") {
          throw new Error("Invalid OPEN_FILE message");
        }
        return message as WebviewMessage;
      case "APPROVE_PERMISSION":
      case "DENY_PERMISSION":
        if (typeof typed.requestId !== "string") {
          throw new Error(`Invalid ${type} message`);
        }
        return message as WebviewMessage;
      case "CONNECT_CURSOR":
      case "DISCONNECT_CURSOR":
        return message as WebviewMessage;
      default: {
        throw new Error(`Unknown message type: ${type}`);
      }
    }
  }
}
