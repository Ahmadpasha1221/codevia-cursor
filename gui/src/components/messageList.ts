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
 *
 * Streaming text and tool/command lifecycle updates mutate ONE element in
 * place instead of rebuilding the list, so no interactive element is ever
 * destroyed while the pointer is down. Scroll is pinned to the bottom only
 * while the user is already at the bottom (sticky scroll), and the scroll
 * write is batched to animation frames.
 */
export interface MessageListHandle {
  append(lines: readonly ChatLine[], handlers?: MessageListHandlers): void;
  /**
   * Replace the entire transcript (used when a session transcript is restored
   * after a restart or a session switch). Handlers are remembered so later
   * incremental appends keep working.
   */
  replaceAll(lines: readonly ChatLine[], handlers?: MessageListHandlers): void;
  /** Remove every line (used when a new conversation is activated). */
  clear(): void;
  /** Create (or replace) the single streaming assistant line. */
  upsertStreamingLine(text: string, handlers?: MessageListHandlers): void;
  /** Finalize the streaming line into a normal agent line. */
  finishStreamingLine(finalText: string): void;
  /** Create or update one tool execution box, matched by toolCallId. */
  upsertToolLine(tool: NonNullable<ChatLine["tool"]>, handlers?: MessageListHandlers): void;
  /** Create or update one command execution box, matched by toolCallId. */
  upsertCommandLine(command: NonNullable<ChatLine["command"]>, handlers?: MessageListHandlers): void;
  /** Flip an existing command box to its terminal state (no new element). */
  completeCommandLine(toolCallId: string | undefined, exitCode: number | null): void;
  /** Resolve a pending permission prompt in place, without rebuilding the list. */
  resolvePermission(requestId: string, decision: "ALLOW" | "DENY"): void;
}

export function createMessageList(root: HTMLElement, initialHandlers?: MessageListHandlers): MessageListHandle {
  let currentHandlers: MessageListHandlers = initialHandlers ?? {};

  const itemByToolCallId = new Map<string, HTMLElement>();
  let streamingLine: HTMLElement | undefined;
  let streamingBody: Text | undefined;
  let streamScheduled = false;
  let scrollScheduled = false;
  let lastStreamText = "";

  function isPinnedToBottom(): boolean {
    return root.scrollHeight - root.scrollTop - root.clientHeight < 48;
  }

  /** Batched, sticky-bottom scroll: one rAF per burst, never mid-frame thrash. */
  function scheduleScroll(force = false): void {
    if (!force && !isPinnedToBottom()) {
      return;
    }
    if (scrollScheduled) {
      return;
    }
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      root.scrollTop = root.scrollHeight;
    });
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
      case "tool":
        return "Tool";
      case "system":
        return "Agent";
    }
  }

  function buildBaseLine(message: ChatLine): { article: HTMLElement; body: HTMLDivElement } {
    const article = document.createElement("article");
    article.className = `message message-${message.role}`;
    const meta = document.createElement("span");
    meta.className = "message-meta";
    meta.textContent = labelFor(message);
    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = bodyText(message);
    article.append(meta, body);
    return { article, body };
  }

  function appendLine(message: ChatLine): void {
    const { article } = buildBaseLine(message);
    appendInteractive(article, message);
    root.appendChild(article);
  }

  function appendInteractive(article: HTMLElement, message: ChatLine): void {
    if (message.permission?.pending) {
      article.appendChild(permissionActions(message.permission.requestId, currentHandlers));
    }
    if (message.fileChange && message.fileChange.status === "APPLIED") {
      article.appendChild(fileChangeActions(message.fileChange, currentHandlers));
    }
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
  }

  /** Updates the streaming line's text node only — no DOM rebuild, no reflow of siblings. */
  function paintStreamingLine(): void {
    if (streamingBody && lastStreamText !== streamingBody.textContent) {
      streamingBody.textContent = lastStreamText;
    }
  }

  return {
    append(lines, handlers) {
      if (handlers) {
        currentHandlers = handlers;
      }
      const pinned = isPinnedToBottom();
      for (const message of lines) {
        appendLine(message);
      }
      syncEmptyState();
      scheduleScroll(pinned);
    },

    replaceAll(lines, handlers) {
      if (handlers) {
        currentHandlers = handlers;
      }
      root.replaceChildren();
      itemByToolCallId.clear();
      streamingLine = undefined;
      streamingBody = undefined;
      const pinned = isPinnedToBottom();
      for (const message of lines) {
        appendLine(message);
      }
      syncEmptyState();
      scheduleScroll(pinned);
    },

    clear() {
      root.replaceChildren();
      itemByToolCallId.clear();
      streamingLine = undefined;
      streamingBody = undefined;
      lastStreamText = "";
      syncEmptyState();
      scheduleScroll(true);
    },

    upsertStreamingLine(text, handlers) {
      if (handlers) {
        currentHandlers = handlers;
      }
      if (!streamingLine || !streamingLine.isConnected) {
        const article = document.createElement("article");
        article.className = "message message-agent streaming-line";
        const meta = document.createElement("span");
        meta.className = "message-meta";
        meta.textContent = "Spider";
        streamingBody = document.createTextNode("");
        const body = document.createElement("div");
        body.className = "message-body";
        body.appendChild(streamingBody);
        article.append(meta, body);
        root.appendChild(article);
        streamingLine = article;
        lastStreamText = "";
        const empty = root.querySelector<HTMLElement>(".empty-chat");
        if (empty) {
          empty.remove();
        }
      }
      lastStreamText = text;
      if (!streamScheduled) {
        streamScheduled = true;
        requestAnimationFrame(() => {
          streamScheduled = false;
          paintStreamingLine();
          scheduleScroll();
        });
      }
    },

    finishStreamingLine(finalText) {
      if (streamingLine && streamingLine.isConnected) {
        paintStreamingLine();
        const streamedText = lastStreamText;
        // Nothing visible was streamed and nothing final arrived: drop the
        // empty line instead of leaving an empty agent bubble.
        if (streamedText.length === 0 && finalText.length === 0) {
          streamingLine.remove();
        } else {
          streamingLine.classList.remove("streaming-line");
          if (finalText.length > 0) {
            const body = streamingLine.querySelector(".message-body");
            if (body) {
              body.textContent = finalText;
            }
          }
        }
        streamingLine = undefined;
        streamingBody = undefined;
        lastStreamText = "";
        return;
      }
      if (finalText.length > 0) {
        const { article } = buildBaseLine({ role: "agent", text: finalText });
        root.appendChild(article);
        scheduleScroll();
      }
    },

    upsertToolLine(tool, handlers) {
      if (handlers) {
        currentHandlers = handlers;
      }
      let article = itemByToolCallId.get(tool.toolCallId);
      const pinned = isPinnedToBottom();
      if (!article || !article.isConnected) {
        article = document.createElement("article");
        article.className = "message message-tool exec-box";
        const meta = document.createElement("span");
        meta.className = "message-meta";
        meta.textContent = "Tool";
        const card = document.createElement("div");
        card.className = "exec-card";
        const head = document.createElement("div");
        head.className = "exec-head";
        const name = document.createElement("span");
        name.className = "exec-name";
        const status = document.createElement("span");
        status.className = "exec-status";
        head.append(name, status);
        const detail = document.createElement("div");
        detail.className = "exec-detail";
        card.append(head, detail);
        article.append(meta, card);
        root.appendChild(article);
        itemByToolCallId.set(tool.toolCallId, article);
      }
      const name = article.querySelector<HTMLElement>(".exec-name");
      const status = article.querySelector<HTMLElement>(".exec-status");
      const detail = article.querySelector<HTMLElement>(".exec-detail");
      if (name) {
        name.textContent = tool.toolName;
      }
      if (status) {
        status.textContent = tool.status === "running" ? "Running" : tool.status === "failed" ? "Failed" : "Completed";
        status.className = `exec-status is-${tool.status}`;
      }
      if (detail) {
        detail.textContent = tool.error ?? tool.detail ?? "";
        detail.hidden = detail.textContent.length === 0;
      }
      article.dataset.status = tool.status;
      syncEmptyState();
      scheduleScroll(pinned);
    },

    upsertCommandLine(command, handlers) {
      if (handlers) {
        currentHandlers = handlers;
      }
      const key = command.toolCallId ?? `cmd:${command.command}`;
      let article = itemByToolCallId.get(key);
      const pinned = isPinnedToBottom();
      if (!article || !article.isConnected) {
        article = document.createElement("article");
        article.className = "message message-tool exec-box";
        const meta = document.createElement("span");
        meta.className = "message-meta";
        meta.textContent = "Command";
        const card = document.createElement("div");
        card.className = "exec-card";
        const head = document.createElement("div");
        head.className = "exec-head";
        const name = document.createElement("span");
        name.className = "exec-name";
        const status = document.createElement("span");
        status.className = "exec-status";
        head.append(name, status);
        const output = document.createElement("pre");
        output.className = "exec-output";
        card.append(head, output);
        article.append(meta, card);
        root.appendChild(article);
        itemByToolCallId.set(key, article);
      }
      const name = article.querySelector<HTMLElement>(".exec-name");
      const status = article.querySelector<HTMLElement>(".exec-status");
      const output = article.querySelector<HTMLElement>(".exec-output");
      if (name) {
        name.textContent = `$ ${command.command}`;
      }
      const failed = command.exitCode !== undefined && command.exitCode !== null && command.exitCode !== 0;
      if (status) {
        status.textContent = command.running ? "Running" : failed ? "Failed" : "Completed";
        status.className = `exec-status is-${command.running ? "running" : failed ? "failed" : "completed"}`;
      }
      if (output) {
        const text = [command.stdout, command.stderr].filter((part) => typeof part === "string" && part.length > 0).join("\n");
        output.textContent = text;
        output.hidden = text.length === 0;
      }
      article.dataset.status = command.running ? "running" : failed ? "failed" : "completed";
      syncEmptyState();
      scheduleScroll(pinned);
    },

    completeCommandLine(toolCallId, exitCode) {
      const key = toolCallId ?? undefined;
      const article = key ? itemByToolCallId.get(key) : undefined;
      if (!article || !article.isConnected) {
        return;
      }
      const status = article.querySelector<HTMLElement>(".exec-status");
      const failed = exitCode !== null && exitCode !== 0;
      if (status) {
        status.textContent = failed ? "Failed" : "Completed";
        status.className = `exec-status is-${failed ? "failed" : "completed"}`;
      }
      article.dataset.status = failed ? "failed" : "completed";
    },

    resolvePermission(requestId, decision) {
      const actions = root.querySelector<HTMLElement>(`.permission-actions[data-request-id="${requestId}"]`);
      if (!actions) {
        return;
      }
      const status = document.createElement("span");
      status.className = "permission-resolved";
      status.textContent = decision === "ALLOW" ? "Allowed" : "Denied";
      actions.replaceWith(status);
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
