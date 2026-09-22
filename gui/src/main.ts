import { onHostMessage, postToHost } from "./bridge";
import { renderStatusBar } from "./components/statusBar";
import type { HostToGui, RuntimeProvider } from "./protocol";
import { AppState, createInitialState } from "./state";
import { renderChatView } from "./views/chatView";
import { renderSettingsView } from "./views/settingsView";

const state: AppState = createInitialState();

const runtimePill = mustEl("runtime-pill");
const settingsBtn = mustEl("settings-btn") as HTMLButtonElement;
const settingsBack = mustEl("settings-back") as HTMLButtonElement;
const setupBanner = mustEl("setup-banner");
const settingsView = mustEl("settings-view");
const chatView = mustEl("chat-view");
const providerSettings = mustEl("provider-settings");
const authFeedback = mustEl("auth-feedback");
const sessionBar = mustEl("session-bar");
const messageList = mustEl("message-list");
const composer = mustEl("composer");
const statusBar = document.createElement("span");

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
      if (!state.selectedModelId && message.models[0]) {
        state.selectedModelId = message.models[0].id;
        state.selectedModelName = message.models[0].name;
      }
      break;
    case "SHOW_SETTINGS":
      state.view = "settings";
      break;
    case "SESSION_UPDATED":
      state.sessions = message.sessions;
      state.activeSessionId = message.activeSessionId ?? message.sessions[0]?.sessionId;
      break;
    case "AGENT_STATE":
      state.running = message.state === "starting" || message.state === "running";
      if (["completed", "cancelled", "failed", "disconnected"].includes(message.state)) state.running = false;
      break;
    case "AGENT_MESSAGE":
      state.messages.push({ role: "agent", text: message.message });
      break;
    case "AGENT_THINKING":
      state.messages.push({ role: "thinking", text: message.message });
      break;
    case "AGENT_TOOL_CALL":
      state.messages.push({ role: "system", text: `Using ${message.toolCall.toolName ?? "tool"}` });
      break;
    case "AGENT_TOOL_RESULT":
      state.messages.push({ role: "system", text: `Completed ${message.result.toolName ?? "tool"}` });
      break;
    case "AGENT_ERROR":
      state.running = false;
      state.messages.push({ role: "error", text: message.error });
      break;
    case "PERMISSION_REQUEST":
      state.messages.push({ role: "system", text: message.message });
      break;
  }
  render();
}

function render(): void {
  runtimePill.textContent = runtimeLabel();
  settingsBtn.textContent = state.view === "settings" ? "Chat" : "Settings";
  const showSettings = state.view === "settings";
  settingsView.hidden = !showSettings;
  chatView.hidden = showSettings;

  renderStatusBar(statusBar, statusLabel(), state.runtimeConnected, Boolean(state.runtimeError || state.authError));

  if (!showSettings) {
    renderSetupBanner();
    renderChatView(
      { sessionBar, messages: messageList, composer },
      state,
      {
        onSelectSession: (sessionId) => postToHost({ type: "SELECT_SESSION", sessionId }),
        onNewSession: () => postToHost({ type: "NEW_SESSION" }),
        onSend: sendPrompt,
        onCancel: cancelRun,
      },
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
      },
      onLocalModel: (modelId) => {
        state.selectedModelId = modelId;
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
  const ready = state.runtimeConnected || state.provider === "mock";
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
  state.messages.push({ role: "user", text: trimmed });
  state.running = true;
  postToHost({ type: "SEND_PROMPT", prompt: trimmed, sessionId: state.activeSessionId });
  render();
}

function cancelRun(): void {
  if (state.activeSessionId) postToHost({ type: "CANCEL_RUN", sessionId: state.activeSessionId });
}

function runtimeLabel(): string {
  if (state.provider === "local") return state.selectedModelName ? `Local · ${state.selectedModelName}` : `Local · ${state.localProvider}`;
  if (state.provider === "mock") return "Mock · Test";
  return "Cursor";
}

function statusLabel(): string {
  if (state.running) return "Agent running";
  if (state.runtimeConnected) return "Ready";
  if (state.provider === "local") return state.localLoading ? "Detecting local models…" : "Local AI not connected";
  if (state.provider === "mock") return "Mock runtime";
  if (state.connecting) return "Connecting to Cursor…";
  return state.authError ?? "Choose an AI provider";
}

function mustEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
