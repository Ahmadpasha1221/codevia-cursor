export function renderApiKeyForm(
  root: HTMLElement,
  options: {
    connecting: boolean;
    hasKey: boolean;
    connected: boolean;
    onConnect: (apiKey: string) => void;
    onDisconnect: () => void;
  },
): void {
  root.replaceChildren();

  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.htmlFor = "api-key-input";
  label.textContent = options.hasKey ? "Replace API key" : "Cursor API key";
  const input = document.createElement("input");
  input.id = "api-key-input";
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = options.hasKey ? "Enter a new key to replace the stored key" : "Paste your Cursor API key";
  input.disabled = options.connecting;
  field.append(label, input);

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const connect = document.createElement("button");
  connect.className = "btn";
  connect.type = "button";
  connect.textContent = options.connecting ? "Connecting…" : options.hasKey ? "Save and connect" : "Save and connect";
  connect.disabled = options.connecting;
  connect.addEventListener("click", () => {
    const value = input.value.trim();
    if (!value && !options.hasKey) {
      return;
    }
    options.onConnect(value);
    input.value = "";
  });

  actions.append(connect);

  if (options.hasKey || options.connected) {
    const disconnect = document.createElement("button");
    disconnect.className = "btn btn-danger";
    disconnect.type = "button";
    disconnect.textContent = "Disconnect";
    disconnect.disabled = options.connecting;
    disconnect.addEventListener("click", options.onDisconnect);
    actions.append(disconnect);
  }

  const reuse = document.createElement("button");
  reuse.className = "btn btn-ghost";
  reuse.type = "button";
  reuse.textContent = "Use stored key";
  reuse.hidden = !options.hasKey;
  reuse.disabled = options.connecting;
  reuse.addEventListener("click", () => options.onConnect(""));
  actions.append(reuse);

  root.append(field, actions);
}
