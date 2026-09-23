import type { ChatLine } from "../state";

export function renderMessageList(
  root: HTMLElement,
  messages: readonly ChatLine[],
  handlers?: {
    onAllowPermission?: (requestId: string) => void;
    onDenyPermission?: (requestId: string) => void;
  },
): void {
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
    meta.textContent = labelFor(message);
    const body = document.createElement("div");
    body.textContent = bodyText(message);
    article.append(meta, body);
    if (message.permission?.pending) {
      article.appendChild(permissionActions(message.permission.requestId, handlers));
    }
    root.appendChild(article);
  }
  root.scrollTop = root.scrollHeight;
}

function bodyText(message: ChatLine): string {
  if (message.permission) {
    const command = message.permission.command ? `$ ${message.permission.command}` : "";
    return ["Permission required", command].filter((part) => part.length > 0).join("\n");
  }
  return message.text;
}

function permissionActions(
  requestId: string,
  handlers?: {
    onAllowPermission?: (requestId: string) => void;
    onDenyPermission?: (requestId: string) => void;
  },
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "permission-actions";
  const allow = document.createElement("button");
  allow.className = "btn";
  allow.type = "button";
  allow.textContent = "Allow";
  allow.addEventListener("click", () => handlers?.onAllowPermission?.(requestId));
  const deny = document.createElement("button");
  deny.className = "btn btn-ghost";
  deny.type = "button";
  deny.textContent = "Deny";
  deny.addEventListener("click", () => handlers?.onDenyPermission?.(requestId));
  actions.append(allow, deny);
  return actions;
}

function labelFor(message: ChatLine): string {
  if (message.permission) {
    return "Permission";
  }
  if (message.command) {
    return "Command";
  }
  switch (message.role) {
    case "user": return "You";
    case "agent": return "Codevia";
    case "thinking": return "Thinking";
    case "error": return "Error";
    default: return "Codevia";
  }
}
