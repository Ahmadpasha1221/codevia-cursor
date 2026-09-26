import type { FileChangeView } from "../protocol";
import type { ChatLine } from "../state";

type MessageListHandlers = {
  onAllowPermission?: (requestId: string) => void;
  onDenyPermission?: (requestId: string) => void;
  onViewDiff?: (changeId: string) => void;
  onAcceptChange?: (changeId: string) => void;
  onRejectChange?: (changeId: string) => void;
};

/**
 * The list appends only new lines and never rebuilds existing DOM. Rebuilding
 * on every host event made the Allow/Deny permission buttons unclickable (the
 * element was replaced between mousedown and mouseup) and reset scroll.
 */
export interface MessageListHandle {
  append(lines: readonly ChatLine[], handlers?: MessageListHandlers): void;
  /**
   * Replace the entire transcript (used when a session transcript is restored
   * after a restart or a session switch). Handlers are remembered so later
   * incremental appends keep working.
   */
  replaceAll(lines: readonly ChatLine[], handlers?: MessageListHandlers): void;
  /** Resolve a pending permission prompt in place, without rebuilding the list. */
  resolvePermission(requestId: string, decision: "ALLOW" | "DENY"): void;
}

export function createMessageList(root: HTMLElement, initialHandlers?: MessageListHandlers): MessageListHandle {
  let currentHandlers: MessageListHandlers = initialHandlers ?? {};

  function appendLine(message: ChatLine): void {
    const article = document.createElement("article");
    article.className = `message message-${message.role}`;
    const meta = document.createElement("span");
    meta.className = "message-meta";
    meta.textContent = labelFor(message);
    const body = document.createElement("div");
    body.textContent = bodyText(message);
    article.append(meta, body);

    if (message.permission?.pending) {
      article.appendChild(permissionActions(message.permission.requestId, currentHandlers));
    }
    if (message.fileChange && message.fileChange.status === "APPLIED") {
      article.appendChild(fileChangeActions(message.fileChange, currentHandlers));
    }
    root.appendChild(article);
  }

  function resolvePermission(requestId: string, decision: "ALLOW" | "DENY"): void {
    const actions = root.querySelector<HTMLElement>(`.permission-actions[data-request-id="${requestId}"]`);
    if (!actions) {
      return;
    }
    const status = document.createElement("span");
    status.className = "permission-resolved";
    status.textContent = decision === "ALLOW" ? "Allowed" : "Denied";
    actions.replaceWith(status);
  }

  function syncEmptyState(): void {
    const hasLines = root.querySelector(".message") !== null;
    const empty = root.querySelector<HTMLElement>(".empty-chat");
    if (!hasLines && !empty) {
      const placeholder = document.createElement("div");
      placeholder.className = "empty-chat";
      placeholder.innerHTML = `<strong>How can I help?</strong><span>Ask Spider to explain, debug, refactor, or work on your code.</span>`;
      root.appendChild(placeholder);
    } else if (hasLines && empty) {
      empty.remove();
    }
    root.scrollTop = root.scrollHeight;
  }

  return {
    append(lines, handlers) {
      if (handlers) {
        currentHandlers = handlers;
      }
      for (const message of lines) {
        appendLine(message);
      }
      syncEmptyState();
    },
    replaceAll(lines, handlers) {
      if (handlers) {
        currentHandlers = handlers;
      }
      root.replaceChildren();
      for (const message of lines) {
        appendLine(message);
      }
      syncEmptyState();
    },
    resolvePermission(requestId, decision) {
      resolvePermission(requestId, decision);
    },
  };
}

function bodyText(message: ChatLine): string {
  if (message.permission) {
    const command = message.permission.command ? `$ ${message.permission.command}` : "";
    return ["Permission required", command].filter((part) => part.length > 0).join("\n");
  }
  return message.text;
}

function labelFor(message: ChatLine): string {
  switch (message.role) {
    case "user":
      return "You";
    case "agent":
      return "Spider";
    case "thinking":
      return "Thinking";
    case "error":
      return "Error";
    case "system":
      return "Agent";
  }
}

function fileChangeActions(
  change: FileChangeView,
  handlers?: MessageListHandlers,
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "file-change-actions";
  actions.dataset.changeId = change.changeId;

  const view = document.createElement("button");
  view.className = "btn btn-ghost";
  view.type = "button";
  view.textContent = "View diff";
  view.addEventListener("click", () => handlers?.onViewDiff?.(change.changeId));

  const accept = document.createElement("button");
  accept.className = "btn";
  accept.type = "button";
  accept.textContent = "Keep";
  accept.addEventListener("click", () => handlers?.onAcceptChange?.(change.changeId));

  const reject = document.createElement("button");
  reject.className = "btn btn-danger";
  reject.type = "button";
  reject.textContent = "Revert";
  reject.addEventListener("click", () => handlers?.onRejectChange?.(change.changeId));

  actions.append(view, accept, reject);
  return actions;
}

function permissionActions(
  requestId: string,
  handlers?: MessageListHandlers,
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "permission-actions";
  actions.dataset.requestId = requestId;
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
