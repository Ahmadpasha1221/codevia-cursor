import type { ChatTurn } from "../tools/inferenceAgentLoop";

/**
 * OpenAI wire messages. Tool turns must reference the assistant tool-call id
 * exactly (`tool_call_id`), and assistant turns carry their `tool_calls` with
 * JSON-string arguments.
 */
export type OpenAiWireMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Serializes internal ChatTurn history into OpenAI-compatible wire messages.
 *
 * The internal loop keeps tool_call_id alongside each tool turn; the wire
 * format requires it on every "tool" message. A missing or empty id is handled
 * explicitly (typed error) instead of sending a request the provider must
 * reject — that failure mode poisons the whole conversation history.
 */
export function toOpenAiMessages(messages: readonly ChatTurn[]): OpenAiWireMessage[] {
  return messages.map((turn) => {
    if (turn.role === "tool") {
      const toolCallId = typeof turn.tool_call_id === "string" ? turn.tool_call_id.trim() : "";
      if (toolCallId.length === 0) {
        throw new Error(
          "A tool message is missing its tool_call_id; the conversation cannot be sent to an OpenAI-compatible provider.",
        );
      }
      return {
        role: "tool" as const,
        tool_call_id: toolCallId,
        content: typeof turn.content === "string" ? turn.content : "",
      };
    }

    if (turn.role === "assistant" && turn.tool_calls && turn.tool_calls.length > 0) {
      return {
        role: "assistant" as const,
        content: typeof turn.content === "string" ? turn.content : "",
        tool_calls: turn.tool_calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.function.name,
            arguments: typeof call.function.arguments === "string" ? call.function.arguments : "{}",
          },
        })),
      };
    }

    return { role: turn.role, content: typeof turn.content === "string" ? turn.content : "" };
  });
}
