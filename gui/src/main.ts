import { onHostMessage, postToHost } from "./bridge";
import type { FileChangeView, HostToGui, RuntimeProvider } from "./protocol";
import { AppState, ChatLine, createInitialState } from "./state";
import { createComposer } from "./components/composer";
import { createMessageList } from "./components/messageList";
import { createSessionBar } from "./components/sessionBar";
import { renderChatView } from "./views/chatView";
import { renderSettingsView } from "./views/settingsView";

const state: AppState = createInitialState();

let loadedTranscriptSessionId: string | undefined;

function isStaleTranscript(sessionId: string): boolean {
  return loadedTranscriptSessionId !== sessionId;
}

const runtimePill = mustEl("runtime-pill");
const settingsBtn = mustEl("settings-btn") as HTMLButtonElement;
const settingsBack = mustEl("settings-back") as HTMLButtonElement;
const setupBanner = mustEl("setup-banner");
const settingsView = mustEl("settings-view");
const chatView = mustEl("chat-view");
const providerSettings = mustEl("provider-settings");
const authFeedback = mustEl("auth-feedback");
const messageListRoot = mustEl("message-list");
const composerRoot = mustEl("composer");
const sessionBarRoot = mustEl("session-bar");

const messageList = createMessageList(messageListRoot, {
  onAllowPermission: (requestId) => resolvePermission(requestId, "ALLOW"),
  onDenyPermission: (requestId) => resolvePermission(requestId, "DENY"),
  onViewDiff: (changeId) => postToHost({ type: "OPEN_DIFF", changeId }),
  onAcceptChange: (changeId) => postToHost({ type: "RESOLVE_FILE_CHANGE", changeId, decision: "ACCEPT" }),
  onRejectChange: (changeId) => postToHost({ type: "RESOLVE_FILE_CHANGE", changeId, decision: "REJECT" }),
});
const composer = createComposer(composerRoot, {
  onSend: handleSend,
  onCancel: cancelRun,
  onRetry: retryLastPrompt,
});
const sessionBar = createSessionBar(sessionBarRoot, {
  onSelect: (sessionId) => {
    loadedTranscriptSessionId = sessionId;
    state.activeSessionId = sessionId;
    postToHost({ type: "SELECT_SESSION", sessionId });
  },
  onCreate: () => postToHost({ type: "NEW_SESSION" }),
});

settingsBtn.addEventListener("click", () => {
  state.view = state.view === "settings" ? "chat" : "settings";
  render();
});
settingsBack.addEventListener("click", () => {
  state.view = "chat";
  render();
});

onHostMessage(handleHostMessage);
postToHost({ type: "GET_AUTH_STATUS" });
postToHost({ type: "GET_RUNTIME_STATUS" });
postToHost({ type: "LIST_SESSIONS" });
render();

function handleSend(prompt: string): void {
  loadedTranscriptSessionId = state.activeSessionId;
  sendPrompt(prompt);
}

function handleHostMessage(message: HostToGui): void {
  switch (message.type) {
    case "AUTH_STATUS":
      state.authStatus = message.status;
      state.hasKey = message.hasKey;
      state.authError = message.error;
      state.authMessage = message.message;
      state.connecting = message.status === "connecting";
      if (message.status === "connected" && state.provider === "cursor") {
        state.runtimeConnected = true;
      }
      break;
    case "RUNTIME_STATUS":
      state.provider = message.provider;
      state.runtimeConnected = message.connected;
      state.selectedModelId = message.modelId;
      state.selectedModelName = message.modelName;
      state.localProvider = message.localProvider ?? state.localProvider;
      state.runtimeError = message.error;
      break;
    case "LOCAL_MODELS":
      state.localLoading = false;
      state.localProvider = message.provider;
      state.localModels = message.models;
      state.runtimeError = message.error;
      if (message.models.length > 0 && !message.error) {
        state.provider = "local";
        state.runtimeConnected = true;
        if (!state.selectedModelId && message.models[0]) {
          state.selectedModelId = message.models[0].id;
          state.selectedModelName = message.models[0].name;
        }
        ensureSession();
      }
      break;
    case "SHOW_SETTINGS":
      state.view = "settings";
      break;
    case "SESSION_UPDATED":
      state.sessions = message.sessions;
      state.activeSessionId = message.activeSessionId ?? message.sessions[0]?.sessionId;
      if (state.activeSessionId && loadedTranscriptSessionId !== state.activeSessionId) {
        postToHost({ type: "GET_TRANSCRIPT", sessionId: state.activeSessionId });
      }
      break;
    case "TRANSCRIPT": {
      if (isStaleTranscript(message.sessionId)) {
        break;
      }
      loadedTranscriptSessionId = message.sessionId;
      state.messages = message.entries.map(toChatLine);
      messageList.replaceAll(state.messages);
      render();
      break;
    }
    case "AGENT_STATE":
      state.running = message.state === "starting" || message.state === "ready" || message.state === "running";
      if (["completed", "cancelled", "failed", "disconnected", "idle"].includes(message.state)) {
        state.running = false;
      }
      break;
    case "AGENT_MESSAGE": {
      const text = sanitizeAgentMessage(message.message);
      if (text.length === 0) {
        break;
      }
      const streamingLine = state.messages.find((line) => line.streaming);
      if (streamingLine) {
        streamingLine.streaming = false;
        streamingLine.role = "agent";
        streamingLine.text = text;
      } else {
        state.messages.push({ role: "agent", text });
      }
      messageList.replaceAll(state.messages);
      break;
    }
    case "AGENT_TEXT_DELTA": {
      if (message.sessionId !== state.activeSessionId) {
        break;
      }
      let streamingLine = state.messages.find((line) => line.streaming);
      if (!streamingLine) {
        streamingLine = { role: "agent", text: "", streaming: true };
        state.messages.push(streamingLine);
      }
      streamingLine.text += message.text;
      if (looksLikeRawToolJson(streamingLine.text)) {
        // The model leaked a raw tool object into the stream; never show it.
        streamingLine.text = "";
      }
      messageList.replaceAll(state.messages);
      break;
    }
    case "AGENT_USAGE":
      state.usage = {
        promptTokens: message.promptTokens,
        completionTokens: message.completionTokens,
        totalTokens: message.totalTokens,
        ...(message.costUsd !== undefined ? { costUsd: message.costUsd } : {}),
      };
      break;
    case "FILE_CHANGE":
    case "FILE_CHANGE_REVERTED":
      state.messages.push({
        role: "system",
        text: fileChangeText(message.change, message.type === "FILE_CHANGE_REVERTED"),
        fileChange: message.change,
      });
      messageList.append(state.messages.slice(-1));
      break;
    case "AGENT_THINKING":
      state.messages.push({ role: "thinking", text: message.message });
      break;
    case "AGENT_TOOL_CALL": {
      const command = message.toolCall.command;
      if (message.toolCall.toolName === "run_command" && command) {
        state.messages.push({
          role: "system",
          text: `Running command:\n$ ${command}`,
          command: { command, running: true },
        });
      } else {
        state.messages.push({
          role: "system",
          text: `Using ${message.toolCall.toolName ?? "tool"}${message.toolCall.path ? ` ${message.toolCall.path}` : ""}`,
        });
      }
      break;
    }
    case "AGENT_TOOL_RESULT":
      state.messages.push({
        role: "system",
        text: message.result.error
          ? `${message.result.toolName ?? "tool"} failed: ${message.result.error}`
          : `Completed ${message.result.toolName ?? "tool"}`,
      });
      break;
    case "AGENT_COMMAND_OUTPUT":
      state.messages.push({
        role: "system",
        text: formatCommandOutput(message.command, message.stdout, message.stderr, message.exitCode),
        command: {
          command: message.command,
          stdout: message.stdout,
          stderr: message.stderr,
          exitCode: message.exitCode,
          running: false,
        },
      });
      break;
    case "AGENT_ERROR":
      state.running = false;
      state.messages.push({ role: "error", text: message.error });
      break;
    case "PERMISSION_REQUEST":
      state.messages.push({
        role: "system",
        text: message.message,
        permission: {
          requestId: message.requestId,
          command: message.command,
          pending: true,
          destructive: message.destructive,
        },
      });
      break;
  }

  const known = pushesChatLine(message);
  if (known) {
    messageList.append(state.messages.slice(-1));
  }
  render();
}

const CHAT_LINE_MESSAGE_TYPES: ReadonlySet<HostToGui["type"]> = new Set([
  "AGENT_MESSAGE",
  "AGENT_THINKING",
  "AGENT_TOOL_CALL",
  "AGENT_TOOL_RESULT",
  "AGENT_COMMAND_OUTPUT",
  "AGENT_ERROR",
  "PERMISSION_REQUEST",
]);

function pushesChatLine(message: HostToGui): boolean {
  return CHAT_LINE_MESSAGE_TYPES.has(message.type);
}

function render(): void {
  runtimePill.textContent = runtimeLabel();
  settingsBtn.textContent = state.view === "settings" ? "Chat" : "Settings";
  const showSettings = state.view === "settings";
  settingsView.hidden = !showSettings;
  chatView.hidden = showSettings;

  if (!showSettings) {
    renderSetupBanner();
    sessionBar.update(state.sessions, state.activeSessionId, state.running);
    renderChatView(
      { composer },
      state,
      {},
    );
  } else {
    renderSettingsView(providerSettings, authFeedback, state, {
      onProvider: selectProvider,
      onCursorConnect: (apiKey) => {
        state.connecting = true;
        state.authError = undefined;
        postToHost(apiKey ? { type: "CONNECT_CURSOR", apiKey } : { type: "CONNECT_CURSOR" });
        render();
      },
      onCursorDisconnect: () => postToHost({ type: "DISCONNECT_CURSOR" }),
      onLocalProvider: (provider) => {
        state.localProvider = provider;
        discoverLocalModels();
        render();
      },
      onRefreshLocal: discoverLocalModels,
      onLocalConnect: (baseUrl, apiKey, modelId) => {
        state.runtimeError = undefined;
        postToHost({ type: "CONNECT_LOCAL", provider: state.localProvider, baseUrl, apiKey, modelId });
        state.view = "chat";
        ensureSession();
      },
      onLocalModel: (modelId) => {
        state.selectedModelId = modelId;
        state.selectedModelName = modelId;
        state.lastPrompt = undefined;
        postToHost({ type: "SELECT_LOCAL_MODEL", modelId });
        render();
      },
      onMock: () => {
        state.provider = "mock";
        state.runtimeConnected = true;
        postToHost({ type: "USE_MOCK_RUNTIME" });
        state.view = "chat";
        ensureSession();
        render();
      },
    });
  }
}

function selectProvider(provider: RuntimeProvider): void {
  state.provider = provider;
  state.runtimeError = undefined;
  if (provider === "local") {
    discoverLocalModels();
  } else if (provider === "mock") {
    state.runtimeConnected = true;
    postToHost({ type: "USE_MOCK_RUNTIME" });
    ensureSession();
  } else {
    state.runtimeConnected = state.authStatus === "connected";
    postToHost({ type: "SELECT_RUNTIME", provider });
  }
  render();
}

function discoverLocalModels(): void {
  state.localLoading = true;
  postToHost({ type: "DISCOVER_LOCAL_MODELS", provider: state.localProvider });
  render();
}

function ensureSession(): void {
  if (state.sessions.length === 0) postToHost({ type: "NEW_SESSION" });
}

function renderSetupBanner(): void {
  const ready =
    state.runtimeConnected
    || state.provider === "mock"
    || (state.provider === "local" && Boolean(state.selectedModelId || state.selectedModelName) && !state.runtimeError);
  setupBanner.hidden = ready;
  if (ready) return;
  setupBanner.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = "Connect an AI provider to start";
  const text = document.createElement("span");
  text.textContent = state.provider === "local"
    ? "Select an installed local model or configure a local endpoint."
    : "Use Cursor with an API key, choose Local AI, or use Mock mode for testing.";
  const button = document.createElement("button");
  button.className = "btn";
  button.textContent = "Choose provider";
  button.onclick = () => { state.view = "settings"; render(); };
  setupBanner.append(title, text, button);
}

function sendPrompt(prompt: string): void {
  const trimmed = prompt.trim();
  if (!trimmed || !state.activeSessionId || state.running) return;
  loadedTranscriptSessionId = state.activeSessionId;
  state.lastPrompt = trimmed;
  state.messages.push({ role: "user", text: trimmed });
  messageList.append(state.messages.slice(-1));
  state.running = true;
  postToHost({ type: "SEND_PROMPT", prompt: trimmed, sessionId: state.activeSessionId });
  render();
}

function retryLastPrompt(): void {
  if (!state.lastPrompt || !state.activeSessionId || state.running) return;
  loadedTranscriptSessionId = state.activeSessionId;
  state.messages.push({ role: "system", text: "Trying again with a fresh inference…" });
  messageList.append(state.messages.slice(-1));
  state.running = true;
  postToHost({ type: "TRY_AGAIN", sessionId: state.activeSessionId });
  render();
}

function cancelRun(): void {
  if (state.activeSessionId) postToHost({ type: "CANCEL_RUN", sessionId: state.activeSessionId });
}

function resolvePermission(requestId: string, decision: "ALLOW" | "DENY"): void {
  const line = [...state.messages].reverse().find((message) => message.permission?.requestId === requestId);
  if (line?.permission) {
    line.permission.pending = false;
  }
  messageList.resolvePermission(requestId, decision);
  postToHost(decision === "ALLOW" ? { type: "APPROVE_PERMISSION", requestId } : { type: "DENY_PERMISSION", requestId });
}

function toChatLine(entry: {
  kind: "user" | "assistant" | "thinking" | "tool" | "command" | "error" | "system";
  text: string;
  toolName?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}): ChatLine {
  switch (entry.kind) {
    case "user":
      return { role: "user", text: entry.text };
    case "assistant":
      return { role: "agent", text: entry.text };
    case "thinking":
      return { role: "thinking", text: entry.text };
    case "error":
      return { role: "error", text: entry.text };
    case "command":
      return {
        role: "system",
        text: formatCommandOutput(entry.command ?? entry.text, entry.stdout ?? "", entry.stderr ?? "", entry.exitCode ?? null),
        command: {
          command: entry.command ?? "",
          stdout: entry.stdout,
          stderr: entry.stderr,
          exitCode: entry.exitCode,
          running: false,
        },
      };
    case "tool":
      return { role: "system", text: toolTranscriptText(entry) };
    case "system":
      return { role: "system", text: entry.text };
  }
}

function toolTranscriptText(entry: {
  text: string;
  toolName?: string;
  path?: string;
  error?: string;
}): string {
  if (entry.error === "destructive") {
    return `Permission required: ${entry.text}`;
  }
  if (entry.error) {
    return `${entry.toolName ?? "tool"} failed: ${entry.error}`;
  }
  const target = entry.path ? ` ${entry.path}` : "";
  return `Used ${entry.toolName ?? "tool"}${target}`;
}

function runtimeLabel(): string {
  const usage = state.usage && state.usage.totalTokens > 0 ? ` · ${formatUsage(state.usage)}` : "";
  if (state.provider === "local") {
    const model = state.selectedModelName ? `${state.selectedModelName}` : state.localProvider;
    const caps = capabilityBadge();
    return `Local · ${model}${caps}${usage}`;
  }
  if (state.provider === "mock") return `Mock · Test${usage}`;
  return `Cursor${usage}`;
}

function capabilityBadge(): string {
  const caps = state.modelCapabilities;
  if (!caps) return "";
  const flags: string[] = [];
  if (caps.toolCalling) flags.push("tools");
  if (caps.reasoning) flags.push("reasoning");
  return flags.length > 0 ? ` [${flags.join(", ")}]` : "";
}

function formatUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd?: number }): string {
  const tokens = `${usage.totalTokens.toLocaleString()} tok`;
  return usage.costUsd !== undefined ? `${tokens} · $${usage.costUsd.toFixed(4)}` : tokens;
}

/** Raw tool JSON must never appear as the assistant's answer. */
function looksLikeRawToolJson(text: string): boolean {
  const trimmed = text.trim();
  return /^\{\s*"name"\s*:/.test(trimmed) && /"arguments"\s*:/.test(trimmed);
}

function sanitizeAgentMessage(text: string): string {
  if (looksLikeRawToolJson(text)) {
    return "";
  }
  return text;
}

function fileChangeText(change: FileChangeView, reverted: boolean): string {
  if (reverted || change.status === "REVERTED") {
    return `Reverted ${change.path}`;
  }
  const kind = change.isNewFile ? "Created" : change.toolName === "edit_file" ? "Edited" : "Wrote";
  return `${kind} ${change.path} (+${change.additions} −${change.deletions})`;
}

function mustEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function formatCommandOutput(command: string, stdout: string, stderr: string, exitCode: number | null): string {
  const output = [stdout, stderr].filter((part) => part.length > 0).join("\n").trim();
  const code = exitCode === null ? "cancelled" : String(exitCode);
  return `Running command:\n$ ${command}\n\n${output.length > 0 ? output + "\n\n" : ""}Exit code: ${code}`;
}
