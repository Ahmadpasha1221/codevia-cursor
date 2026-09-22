export function renderComposer(
  root: HTMLElement,
  options: {
    disabled: boolean;
    running: boolean;
    onSend: (prompt: string) => void;
    onCancel: () => void;
  },
): void {
  root.replaceChildren();

  const textarea = document.createElement("textarea");
  textarea.placeholder = options.disabled ? "Choose an AI provider to start chatting…" : "Ask Codevia about your code…";
  textarea.disabled = options.disabled;
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!options.disabled && !options.running) {
        options.onSend(textarea.value);
        textarea.value = "";
      }
    }
  });

  const actions = document.createElement("div");
  actions.className = "composer-actions";
  const send = document.createElement("button");
  send.className = "btn";
  send.type = "button";
  send.textContent = options.running ? "Running…" : "Send";
  send.disabled = options.disabled || options.running;
  send.addEventListener("click", () => {
    options.onSend(textarea.value);
    textarea.value = "";
  });
  const cancel = document.createElement("button");
  cancel.className = "btn btn-ghost";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.disabled = !options.running;
  cancel.addEventListener("click", options.onCancel);
  actions.append(send, cancel);
  root.append(textarea, actions);
}
