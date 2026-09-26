import { onHostMessage, postToHost } from "./bridge";
import type { FileChangeView, HostToGui, RuntimeProvider, SessionListItem } from "./protocol";
import { AppState, ChatLine, createInitialState, phaseFromAgentState } from "./state";
import { createComposer } from "./components/composer";
import { createHistoryList } from "./components/historyList";
import { createMessageList } from "./components/messageList";
import { createSessionBar } from "./components/sessionBar";
import { renderChatView } from "./views/chatView";
import { renderSettingsView } from "./views/settingsView";

const state: AppState = createInitialState();

/**
 * Transcript staleness guard. A transcript reply is only applied when it is
 * for the session the user actually asked to load (or is actively using).
 * Optimistically starting a new conversation re-points this id immediately,
 * so stale replies for the old conversation can never overwrite empty state.
 */
let loadedTranscriptSessionId: string | undefined;

function isStaleTranscript(sessionId: string): boolean {
  return loadedTranscriptSessionId !== sessionId;
}

const runtimePill = mustEl("runtime-pill");
const settingsBtn = mustEl("settings-btn") as HTMLButtonElement;
const settingsBack = mustEl("settings-back") as HTMLButtonElement;
const historyBtn = mustEl("history-btn") as HTMLButtonElement;
const historyBack = mustEl("history-back") as HTMLButtonElement;
const historyView = mustEl("history-view");
const historyListRoot = mustEl("history-list");
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
  onSelect: (sessionId) => selectSession(sessionId),
  onCreate: () => startNewConversation(),
});
const historyList = createHistoryList(historyListRoot, {
  onOpen: (sessionId) => {
    state.view = "chat";
    selectSession(sessionId);
    render();
  },
  onNew: () => {
    state.view = "chat";
    startNewConversation();
    render();
  },
});

settingsBtn.addEventListener("click", () => {
  state.view = state.view === "settings" ? "chat" : "settings";
  render();
});
settingsBack.addEventListener("click", () => {
  state.view = "chat";
  render();
});
historyBtn.addEventListener("click", () => {
  state.view = state.view === "history" ? "chat" : "history";
  render();
});
historyBack.addEventListener("click", () => {
  state.view = "chat";
  render();
});

onHostMessage(handleHostMessage);
postToHost({ type: "GET_AUTH_STATUS" });
postToHost({ type: "GET_RUNTIME_STATUS" });
postToHost({ type: "LIST_SESSIONS" });
render();

/**
 * Activates an existing conversation immediately in the UI (optimistic), then
 * asks the host for it. Re-pointing loadedTranscriptSessionId before the
 * request is what makes the optimistic reset immune to stale transcript
 * replies. GET_TRANSCRIPT on an unknown/empty session returns no TRANSCRIPT
 * message, so the empty state survives until real content exists.
 */
function selectSession(sessionId: string): void {
  loadedTranscriptSessionId = sessionId;
  state.activeSessionId = sessionId;
  state.pendingNewConversation = false;
  state.running = false;
  state.phase = "idle";
  postToHost({ type: "SELECT_SESSION", sessionId });
  postToHost({ type: "GET_TRANSCRIPT", sessionId });
}

/**
 * New conversation lifecycle: reset the active conversation state immediately
 * (empty chat, fresh active id semantics) and ask the host for a session.
 * The host replies with SESSION_UPDATED for the new id; until then
 * pendingNewConversation keeps the composer from sending into the old
 * conversation. Repeated clicks are safe: when the active session is already
 * an empty conversation, NEW_SESSION is not sent again (host-side dedupe too).
 */
function startNewConversation(): void {
  if (state.pendingNewConversation) {
    return;
  }
  const currentMessages = state.messages;
  const activeIsEmpty = currentMessages.length === 0;
  if (activeIsEmpty) {
    // Already an empty active conversation: nothing to reset.
    state.pendingNewConversation = false;
    return;
  }
  state.pendingNewConversation = true;
  state.activeSessionId = undefined;
  loadedTranscriptSessionId = undefined;
  state.messages = [];
  state.lastPrompt = undefined;
  state.running = false;
  state.phase = "idle";
  messageList.clear();
  postToHost({ type: "NEW_SESSION" });
}

function handleSend(prompt: string): void {
  sendPrompt(prompt);
}

function handleHostMessage(message: HostToGui): void {
  let chatLineChanged = false;

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
      if (message.provider === "openrouter" && message.connected && state.openRouterModels.length === 0 && !state.openRouterLoading) {
        discoverOpenRouterModels();
      }
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
    case "OPENROUTER_MODELS":
      state.openRouterLoading = false;
      state.openRouterModels = message.models;
      state.runtimeError = message.error;
      if (message.models.length > 0 && !message.error) {
        state.provider = "openrouter";
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
    case "SHOW_HISTORY":
      state.view = "history";
      break;
    case "SESSION_UPDATED":
      applySessionUpdate(message.sessions, message.activeSessionId);
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
      applyAgentState(message.state);
      break;
    case "AGENT_MESSAGE": {
      const text = sanitizeAgentMessage(message.message);
      if (text.length === 0) {
        break;
      }
      messageList.finishStreamingLine(text);
      chatLineChanged = true;
      break;
    }
    case "AGENT_TEXT_DELTA": {
      if (message.sessionId !== state.activeSessionId) {
        break;
      }
      let text = message.text;
      if (looksLikeRawToolJson(text)) {
        // The model leaked a raw tool object into the stream; never show it.
        text = "";
      }
      state.phase = "streaming";
      messageList.upsertStreamingLine(text);
      chatLineChanged = true;
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
    case "FILE_CHANGE_REVERTED": {
      const line: ChatLine = {
        role: "system",
        text: fileChangeText(message.change, message.type === "FILE_CHANGE_REVERTED"),
        fileChange: message.change,
      };
      state.messages.push(line);
      messageList.append([line]);
      chatLineChanged = true;
      break;
    }
    case "AGENT_THINKING": {
      const line: ChatLine = { role: "thinking", text: message.message };
      state.messages.push(line);
      messageList.append([line]);
      chatLineChanged = true;
      break;
    }
    case "AGENT_TOOL_CALL": {
      // tool_requested: create the execution box; later events update it in place.
      const toolCall = message.toolCall;
      if (toolCall.toolName === "run_command" && toolCall.command) {
        messageList.upsertCommandLine({ command: toolCall.command, running: true, toolCallId: toolCall.toolCallId });
      } else {
        messageList.upsertToolLine({
          toolCallId: toolCall.toolCallId ?? `tool:${toolCall.toolName}`,
          toolName: toolCall.toolName ?? "tool",
          status: "running",
          detail: toolCall.path,
        });
      }
      state.phase = "toolRunning";
      chatLineChanged = true;
      break;
    }
    case "AGENT_TOOL_RESULT": {
      const key = message.result.toolCallId ?? `tool:${message.result.toolName}`;
      const isCommand = message.result.toolName === "run_command";
      if (isCommand) {
        // The command box already exists from AGENT_TOOL_CALL; flip its state
        // in place. AGENT_COMMAND_OUTPUT (which arrives first, with the exit
        // code and streamed output) already finalized the status chip.
        messageList.completeCommandLine(message.result.toolCallId, message.result.error ? 1 : 0);
      } else {
        messageList.upsertToolLine({
          toolCallId: key,
          toolName: message.result.toolName ?? "tool",
          status: message.result.error ? "failed" : "completed",
          ...(message.result.error ? { error: message.result.error } : {}),
        });
      }
      state.phase = "streaming";
      chatLineChanged = true;
      break;
    }
    case "AGENT_COMMAND_OUTPUT": {
      messageList.upsertCommandLine({
        command: message.command,
        running: false,
        stdout: message.stdout,
        stderr: message.stderr,
        exitCode: message.exitCode,
        toolCallId: message.toolCallId,
      });
      chatLineChanged = true;
      break;
    }
    case "AGENT_ERROR": {
      state.running = false;
      state.phase = "failed";
      messageList.finishStreamingLine("");
      const errorLine: ChatLine = { role: "error", text: message.error };
      state.messages.push(errorLine);
      messageList.append([errorLine]);
      chatLineChanged = true;
      break;
    }
    case "PERMISSION_REQUEST": {
      const line: ChatLine = {
        role: "system",
        text: message.message,
        permission: {
          requestId: message.requestId,
          command: message.command,
          pending: true,
          destructive: message.destructive,
        },
      };
      state.messages.push(line);
      messageList.append([line]);
      chatLineChanged = true;
      break;
    }
  }

  const known = pushesChatLine(message);
  if (known && !chatLineChanged) {
    // Fallback for any chat-line message not handled above.
    messageList.append(state.messages.slice(-1));
  }
  scheduleUiSync();
}

/** Session list arrived: adopt the host's active id and resolve pending New. */
function applySessionUpdate(sessions: SessionListItem[], activeSessionId?: string): void {
  state.sessions = sessions;
  const hostActive = activeSessionId ?? sessions[0]?.sessionId;
  if (state.pendingNewConversation) {
    if (hostActive && hostActive !== state.activeSessionId) {
      // The new conversation is confirmed: it is now active and empty.
      state.activeSessionId = hostActive;
      loadedTranscriptSessionId = hostActive;
      state.messages = [];
      messageList.clear();
    }
    // Stay pending until the host confirms a session we did not have before.
    if (hostActive) {
      state.pendingNewConversation = false;
    }
    return;
  }
  state.activeSessionId = hostActive;
  if (state.activeSessionId && loadedTranscriptSessionId !== state.activeSessionId) {
    postToHost({ type: "GET_TRANSCRIPT", sessionId: state.activeSessionId });
  }
}

/** Backend AGENT_STATE is the source of truth for the phase machine. */
function applyAgentState(agentState: string): void {
  state.phase = phaseFromAgentState(agentState);
  state.running = agentState === "starting" || agentState === "ready" || agentState === "running";
  if (["completed", "cancelled", "failed", "disconnected", "idle"].includes(agentState)) {
    state.running = false;
    messageList.finishStreamingLine("");
  }
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

/**
 * Single batched UI sync per event burst. Cheap state reads
 * (textContent/hidden) stay synchronous; anything layout-affecting or
 * burst-prone (streaming text, scroll) is already rAF-batched inside the
 * message list.
 */
let uiSyncScheduled = false;
function scheduleUiSync(): void {
  if (uiSyncScheduled) {
    return;
  }
  uiSyncScheduled = true;
  requestAnimationFrame(() => {
    uiSyncScheduled = false;
    render();
  });
}

function render(): void {
  runtimePill.textContent = runtimeLabel();
  settingsBtn.textContent = state.view === "settings" ? "Chat" : "Settings";
  historyBtn.textContent = state.view === "history" ? "Chat" : "History";
  const showSettings = state.view === "settings";
  const showHistory = state.view === "history";
  settingsView.hidden = !showSettings;
  historyView.hidden = !showHistory;
  chatView.hidden = showSettings || showHistory;

  if (showHistory) {
    historyList.update(state.sessions, state.activeSessionId, state.running);
    return;
  }

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
      onOpenRouterConnect: (apiKey) => {
        state.openRouterLoading = true;
        state.runtimeError = undefined;
        postToHost({ type: "CONNECT_OPENROUTER", apiKey });
        render();
      },
      onOpenRouterDisconnect: () => {
        state.runtimeConnected = false;
        state.openRouterModels = [];
        postToHost({ type: "DISCONNECT_OPENROUTER" });
        render();
      },
      onRefreshOpenRouter: discoverOpenRouterModels,
      onOpenRouterModel: (modelId) => {
        state.selectedModelId = modelId;
        state.selectedModelName = state.openRouterModels.find((model) => model.id === modelId)?.name ?? modelId;
        postToHost({ type: "SELECT_OPENROUTER_MODEL", modelId });
        render();
      },
      onOpenRouterSearch: (query) => {
        state.openRouterModelFilter = query;
        render();
      },
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
  } else if (provider === "openrouter") {
    postToHost({ type: "SELECT_RUNTIME", provider });
    if (state.hasKey) {
      discoverOpenRouterModels();
    }
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

function discoverOpenRouterModels(): void {
  state.openRouterLoading = true;
  state.runtimeError = undefined;
  postToHost({ type: "DISCOVER_OPENROUTER_MODELS" });
  render();
}

function ensureSession(): void {
  if (state.sessions.length === 0 && !state.pendingNewConversation) postToHost({ type: "NEW_SESSION" });
}

function renderSetupBanner(): void {
  const ready =
    state.runtimeConnected
    || state.provider === "mock"
    || (state.provider === "local" && Boolean(state.selectedModelId || state.selectedModelName) && !state.runtimeError)
    || (state.provider === "openrouter" && Boolean(state.selectedModelId) && !state.runtimeError);
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
  if (!trimmed || state.running || state.pendingNewConversation) return;
  if (!state.activeSessionId) {
    // No active conversation: create one and queue nothing; the composer
    // stays usable and the user can send again once the session exists.
    startNewConversation();
    return;
  }
  loadedTranscriptSessionId = state.activeSessionId;
  state.lastPrompt = trimmed;
  state.running = true;
  state.phase = "submitting";
  const line: ChatLine = { role: "user", text: trimmed };
  state.messages.push(line);
  messageList.append([line]);
  postToHost({ type: "SEND_PROMPT", prompt: trimmed, sessionId: state.activeSessionId });
  scheduleUiSync();
}

function retryLastPrompt(): void {
  if (!state.lastPrompt || !state.activeSessionId || state.running || state.pendingNewConversation) return;
  loadedTranscriptSessionId = state.activeSessionId;
  state.running = true;
  state.phase = "submitting";
  postToHost({ type: "TRY_AGAIN", sessionId: state.activeSessionId });
  scheduleUiSync();
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
      return { role: "system", text: "", command: { command: entry.command ?? "", stdout: entry.stdout, stderr: entry.stderr, exitCode: entry.exitCode, running: false } };
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
  if (state.provider === "openrouter") {
    const model = state.selectedModelName ?? state.selectedModelId ?? "OpenRouter";
    return `OpenRouter · ${model}${usage}`;
  }
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
