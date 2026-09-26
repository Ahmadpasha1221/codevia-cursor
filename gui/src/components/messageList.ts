import type { ChatLine } from "../state";

export function renderMessageList(root: HTMLElement, messages: readonly ChatLine[]): void {
  root.replaceChildren();
  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.innerHTML = `<strong>How can I help?</strong><span>Ask Codevia to explain, debug, refactor, or work on your code.</span>`;
    root.appendChild(empty);
    return;
  }
  for (const message of messages) {
    const article = document.createElement("article");
    article.className = `message message-${message.role}`;
    const meta = document.createElement("span");
    meta.className = "message-meta";
    meta.textContent = labelFor(message.role);
    const body = document.createElement("div");
    body.textContent = message.text;
    article.append(meta, body);
    root.appendChild(article);
  }
  root.scrollTop = root.scrollHeight;
}

function labelFor(role: ChatLine["role"]): string {
  switch (role) {
    case "user": return "You";
    case "agent": return "Codevia";
    case "thinking": return "Thinking";
    case "error": return "Error";
    default: return "Codevia";
  }
}
