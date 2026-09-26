import type { AppState } from "../state";
import type { LocalProvider, RuntimeProvider } from "../protocol";

export function renderProviderSettings(
  root: HTMLElement,
  state: AppState,
  handlers: {
    onProvider: (provider: RuntimeProvider) => void;
    onCursorConnect: (apiKey: string) => void;
    onCursorDisconnect: () => void;
    onLocalProvider: (provider: LocalProvider) => void;
    onRefreshLocal: () => void;
    onLocalConnect: (baseUrl: string, apiKey: string, modelId: string) => void;
    onLocalModel: (modelId: string) => void;
    onMock: () => void;
  },
): void {
  root.replaceChildren();

  const section = document.createElement("div");
  section.className = "settings-section";

  const providerField = document.createElement("div");
  providerField.className = "field";
  const providerLabel = document.createElement("label");
  providerLabel.textContent = "AI provider";
  const providerSelect = document.createElement("select");
  providerSelect.className = "select-control";
  for (const [value, label] of [["cursor", "Cursor"], ["local", "Local AI"], ["mock", "Mock / Test"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = state.provider === value;
    providerSelect.appendChild(option);
  }
  providerSelect.addEventListener("change", () => handlers.onProvider(providerSelect.value as RuntimeProvider));
  providerField.append(providerLabel, providerSelect);
  section.appendChild(providerField);

  if (state.provider === "cursor") {
    renderCursor(section, state, handlers);
  } else if (state.provider === "local") {
    renderLocal(section, state, handlers);
  } else {
    renderMock(section, handlers);
  }

  root.appendChild(section);
}

function renderCursor(root: HTMLElement, state: AppState, handlers: Parameters<typeof renderProviderSettings>[2]): void {
  const card = document.createElement("div");
  card.className = "provider-card";
  card.innerHTML = `<h2>Cursor</h2><p class="hint">Use Cursor's agent with your Cursor account or user API key.</p>`;

  const status = document.createElement("div");
  status.className = `connection-state ${state.authStatus === "error" ? "is-error" : ""}`;
  status.textContent = state.authStatus === "connected" ? "Connected" : state.connecting ? "Connecting…" : state.hasKey ? "API key saved" : "Not connected";
  card.appendChild(status);

  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = state.hasKey ? "Replace Cursor API key" : "Cursor API key";
  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = "Paste your Cursor API key";
  input.disabled = state.connecting;
  field.append(label, input);
  card.appendChild(field);

  const actions = document.createElement("div");
  actions.className = "form-actions";
  const connect = document.createElement("button");
  connect.className = "btn";
  connect.textContent = state.connecting ? "Connecting…" : "Save and connect";
  connect.disabled = state.connecting;
  connect.onclick = () => {
    const value = input.value.trim();
    if (!value && !state.hasKey) return;
    handlers.onCursorConnect(value);
    input.value = "";
  };
  actions.appendChild(connect);

  if (state.hasKey || state.authStatus === "connected") {
    const disconnect = document.createElement("button");
    disconnect.className = "btn btn-danger";
    disconnect.textContent = "Disconnect";
    disconnect.disabled = state.connecting;
    disconnect.onclick = handlers.onCursorDisconnect;
    actions.appendChild(disconnect);
  }
  card.appendChild(actions);
  root.appendChild(card);
}

function renderLocal(root: HTMLElement, state: AppState, handlers: Parameters<typeof renderProviderSettings>[2]): void {
  const card = document.createElement("div");
  card.className = "provider-card";

  const heading = document.createElement("h2");
  heading.textContent = "Local AI";
  card.appendChild(heading);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Use models running on your machine. Codevia discovers installed models through the local provider.";
  card.appendChild(hint);

  const providerField = document.createElement("div");
  providerField.className = "field";
  const providerLabel = document.createElement("label");
  providerLabel.textContent = "Local provider";
  const providerSelect = document.createElement("select");
  providerSelect.className = "select-control";
  for (const [value, label] of [["ollama", "Ollama"], ["openai-compatible", "OpenAI-compatible"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = state.localProvider === value;
    providerSelect.appendChild(option);
  }
  providerSelect.onchange = () => handlers.onLocalProvider(providerSelect.value as LocalProvider);
  providerField.append(providerLabel, providerSelect);
  card.appendChild(providerField);

  if (state.localProvider === "ollama") {
    const status = document.createElement("div");
    status.className = "local-status";
    status.textContent = state.localLoading ? "Detecting Ollama models…" : state.runtimeConnected ? "Ollama connected" : "Ollama not connected";
    card.appendChild(status);
  } else {
    const baseField = document.createElement("div");
    baseField.className = "field";
    const baseLabel = document.createElement("label");
    baseLabel.textContent = "Base URL";
    const baseInput = document.createElement("input");
    baseInput.id = "local-base-url";
    baseInput.placeholder = "http://localhost:1234/v1";
    baseField.append(baseLabel, baseInput);
    card.appendChild(baseField);
  }

  const modelField = document.createElement("div");
  modelField.className = "field";
  const modelLabel = document.createElement("label");
  modelLabel.textContent = "Available model";
  const modelSelect = document.createElement("select");
  modelSelect.className = "select-control";
  if (state.localModels.length === 0) {
    const option = document.createElement("option");
    option.textContent = state.localLoading ? "Detecting models…" : "No models detected";
    option.disabled = true;
    option.selected = true;
    modelSelect.appendChild(option);
  } else {
    for (const model of state.localModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name;
      option.selected = model.id === state.selectedModelId;
      modelSelect.appendChild(option);
    }
  }
  modelSelect.disabled = state.localModels.length === 0;
  modelSelect.onchange = () => handlers.onLocalModel(modelSelect.value);
  modelField.append(modelLabel, modelSelect);
  card.appendChild(modelField);

  if (state.localProvider === "openai-compatible") {
    const keyField = document.createElement("div");
    keyField.className = "field";
    const keyLabel = document.createElement("label");
    keyLabel.textContent = "API key (optional)";
    const keyInput = document.createElement("input");
    keyInput.id = "local-api-key";
    keyInput.type = "password";
    keyInput.autocomplete = "off";
    keyInput.placeholder = "Optional local server key";
    keyField.append(keyLabel, keyInput);
    card.appendChild(keyField);

    const connect = document.createElement("button");
    connect.className = "btn";
    connect.textContent = "Connect local provider";
    connect.onclick = () => {
      const baseUrl = (card.querySelector("#local-base-url") as HTMLInputElement)?.value.trim();
      const apiKey = (card.querySelector("#local-api-key") as HTMLInputElement)?.value.trim();
      handlers.onLocalConnect(baseUrl, apiKey, modelSelect.value);
    };
    card.appendChild(connect);
  }

  const actions = document.createElement("div");
  actions.className = "form-actions";
  const refresh = document.createElement("button");
  refresh.className = "btn btn-ghost";
  refresh.textContent = "Refresh models";
  refresh.onclick = handlers.onRefreshLocal;
  actions.appendChild(refresh);
  if (state.selectedModelId && state.localProvider === "ollama") {
    const use = document.createElement("button");
    use.className = "btn";
    use.textContent = "Use this model";
    use.onclick = () => handlers.onLocalConnect("", "", state.selectedModelId ?? "");
    actions.appendChild(use);
  }
  card.appendChild(actions);

  root.appendChild(card);
}

function renderMock(root: HTMLElement, handlers: Parameters<typeof renderProviderSettings>[2]): void {
  const card = document.createElement("div");
  card.className = "provider-card";
  card.innerHTML = `<h2>Mock / Test</h2><p class="hint">Test the Codevia UI and agent flow without a Cursor API key, local model, or external network request.</p>`;
  const status = document.createElement("div");
  status.className = "connection-state is-connected";
  status.textContent = "Ready — no external AI service required";
  card.appendChild(status);
  const button = document.createElement("button");
  button.className = "btn";
  button.textContent = "Use Mock Runtime";
  button.onclick = handlers.onMock;
  card.appendChild(button);
  root.appendChild(card);
}
