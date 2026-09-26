import type { RuntimeToolCall } from "../runtimeTypes";
import { isLocalToolName } from "./localToolDefinitions";

export function parseToolCallsFromText(text: string): RuntimeToolCall[] {
  const calls: RuntimeToolCall[] = [];
  const tagged = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagged.exec(text)) !== null) {
    calls.push(...toToolCalls(parseJsonPayload(match[1] ?? "")));
  }

  if (calls.length === 0) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      calls.push(...toToolCalls(parseJsonPayload(fenced[1])));
    }
  }

  if (calls.length === 0) {
    for (const candidate of extractJsonValues(text)) {
      calls.push(...toToolCalls(candidate));
    }
  }

  return dedupe(calls);
}

export function parseNativeToolCalls(raw: unknown): RuntimeToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const calls: RuntimeToolCall[] = [];
  for (const entry of raw) {
    calls.push(...toToolCalls(normalizeNativeCall(entry)));
  }
  return dedupe(calls);
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

function toToolCalls(value: unknown): RuntimeToolCall[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => toToolCalls(entry));
  }
  if (!isRecord(value) || typeof value.name !== "string" || !isLocalToolName(value.name)) {
    return [];
  }
  const input = value.arguments ?? value.input ?? value.parameters ?? {};
  return [
    {
      id: typeof value.id === "string" && value.id.length > 0 ? value.id : crypto.randomUUID(),
      name: value.name,
      input: isRecord(input) ? input : {},
    },
  ];
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
