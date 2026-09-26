import type { RuntimeToolCall } from "../runtimeTypes";
import { isLocalToolName } from "./toolRegistry";

export type InvalidToolReason = "unknown-tool" | "malformed";

export interface InvalidToolMention {
  readonly name?: string;
  readonly raw: string;
  readonly reason: InvalidToolReason;
}

export interface ParsedToolOutput {
  /** Tool calls whose names exist in the registry and can be executed. */
  readonly calls: RuntimeToolCall[];
  /** Model-produced tool-like objects that do NOT match the registry. */
  readonly invalid: InvalidToolMention[];
}

/**
 * Full classification of model output: valid calls, invalid tool names, and
 * malformed fragments are distinguished so the agent loop can recover from
 * hallucinated tools (e.g. {"name":"execute"}) instead of leaking the raw JSON
 * into the chat as an assistant message.
 */
export function parseToolOutputFromText(text: string): ParsedToolOutput {
  const objects = collectJsonObjects(text);
  return classifyObjects(objects);
}

/** Back-compat wrapper: valid calls only. */
export function parseToolCallsFromText(text: string): RuntimeToolCall[] {
  return parseToolOutputFromText(text).calls;
}

export function parseNativeToolCalls(raw: unknown): RuntimeToolCall[] {
  return parseNativeToolOutput(raw).calls;
}

export function parseNativeToolOutput(raw: unknown): ParsedToolOutput {
  if (!Array.isArray(raw)) {
    return { calls: [], invalid: [] };
  }
  return classifyObjects(raw.map(normalizeNativeCall));
}

function classifyObjects(objects: readonly unknown[]): ParsedToolOutput {
  const calls: RuntimeToolCall[] = [];
  const invalid: InvalidToolMention[] = [];
  for (const object of objects) {
    const classified = classifyObject(object);
    if (classified.kind === "call") {
      calls.push(classified.call);
    } else if (classified.kind === "invalid") {
      invalid.push(classified.mention);
    }
  }
  return { calls: dedupe(calls), invalid };
}

type Classified =
  | { kind: "call"; call: RuntimeToolCall }
  | { kind: "invalid"; mention: InvalidToolMention }
  | { kind: "ignore" };

function classifyObject(value: unknown): Classified {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const classified = classifyObject(entry);
      if (classified.kind !== "ignore") {
        return classified;
      }
    }
    return { kind: "ignore" };
  }
  if (!isRecord(value)) {
    return { kind: "ignore" };
  }

  const name = typeof value.name === "string" ? value.name : undefined;
  if (!name) {
    // A JSON object without a tool name is usually ordinary JSON content.
    return { kind: "ignore" };
  }

  if (isLocalToolName(name)) {
    const input = value.arguments ?? value.input ?? value.parameters ?? {};
    return {
      kind: "call",
      call: {
        id: typeof value.id === "string" && value.id.length > 0 ? value.id : crypto.randomUUID(),
        name,
        input: isRecord(input) ? input : {},
      },
    };
  }

  return {
    kind: "invalid",
    mention: {
      name,
      raw: safeJson(value),
      reason: "unknown-tool",
    },
  };
}

function collectJsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];

  const tagged = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagged.exec(text)) !== null) {
    const parsed = parseJsonPayload(match[1] ?? "");
    if (parsed !== undefined) {
      objects.push(parsed);
    }
  }

  if (objects.length === 0) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      const parsed = parseJsonPayload(fenced[1]);
      if (parsed !== undefined) {
        objects.push(parsed);
      }
    }
  }

  if (objects.length === 0) {
    for (const candidate of extractJsonValues(text)) {
      objects.push(candidate);
    }
  }

  return objects;
}

function extractJsonValues(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !trimmed.includes("{")) {
    return [];
  }

  const direct = parseJsonPayload(trimmed);
  if (direct !== undefined) {
    return [direct];
  }

  const values: unknown[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") {
      continue;
    }
    const slice = readBalancedObject(text, index);
    if (!slice) {
      continue;
    }
    const parsed = parseJsonPayload(slice);
    if (parsed !== undefined) {
      values.push(parsed);
      index += slice.length - 1;
    }
  }
  return values;
}

function readBalancedObject(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function normalizeNativeCall(entry: unknown): unknown {
  if (!isRecord(entry)) {
    return entry;
  }
  const fn = isRecord(entry.function) ? entry.function : entry;
  const name = typeof fn.name === "string" ? fn.name : undefined;
  const args = fn.arguments ?? fn.input ?? fn.parameters;
  if (!name) {
    return entry;
  }
  return { name, arguments: parseJsonPayload(typeof args === "string" ? args : args) };
}

function parseJsonPayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function dedupe(calls: RuntimeToolCall[]): RuntimeToolCall[] {
  const seen = new Set<string>();
  const result: RuntimeToolCall[] = [];
  for (const call of calls) {
    const key = `${call.name}:${safeJson(call.input)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(call);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
