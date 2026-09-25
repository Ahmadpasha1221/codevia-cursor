/**
 * The composer is built once and then updated in place. Rebuilding it on every
 * state change destroyed the Send button between mousedown and mouseup (eating
 * clicks) and wiped text while the user typed.
 */
export interface ComposerHandle {
  update(options: {
    disabled: boolean;
    running: boolean;
    canRetry?: boolean;
    readyForInput: boolean;
  }): void;
}

export function createComposer(
  root: HTMLElement,
  options: {
    onSend: (prompt: string) => void;
    onCancel: () => void;
    onRetry?: () => void;
  },
): ComposerHandle {
  root.replaceChildren();

  const textarea = document.createElement("textarea");
  textarea.rows = 3;

  const actions = document.createElement("div");
  actions.className = "composer-actions";

  const send = document.createElement("button");
  send.className = "btn";
  send.type = "button";
  send.textContent = "Send";
  send.addEventListener("click", () => {
    options.onSend(textarea.value);
    textarea.value = "";
    textarea.focus();
  });

  const retry = document.createElement("button");
  retry.className = "btn btn-ghost";
  retry.type = "button";
  retry.textContent = "Try Again";
  retry.addEventListener("click", () => options.onRetry?.());

  const cancel = document.createElement("button");
  cancel.className = "btn btn-ghost";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", options.onCancel);

  actions.append(send, retry, cancel);
  root.append(textarea, actions);

  let disabled = false;
  let running = false;
  let canRetry = false;

  function sync(): void {
    const inputDisabled = disabled || running;
    textarea.disabled = inputDisabled;
    textarea.placeholder = disabled
      ? "Choose an AI provider to start chatting…"
      : running
        ? "The agent is running…"
        : "Ask Codevia about your code…";
    send.textContent = running ? "Running…" : "Send";
    send.disabled = inputDisabled || textarea.value.trim().length === 0;
    retry.disabled = !canRetry || running;
    cancel.disabled = !running;
  }

  textarea.addEventListener("input", sync);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!textarea.disabled) {
        options.onSend(textarea.value);
        textarea.value = "";
        sync();
        textarea.focus();
      }
    }
  });

  sync();

  return {
    update(next): void {
      disabled = next.disabled;
      running = next.running;
      canRetry = next.canRetry ?? false;
      void next.readyForInput;
      sync();
    },
  };
}
