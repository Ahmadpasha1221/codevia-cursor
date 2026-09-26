import type { SessionListItem } from "../protocol";

export interface HistoryListHandle {
  /** Dirty-checked rebuild; safe because the list holds no text inputs. */
  update(
    sessions: readonly SessionListItem[],
    activeSessionId: string | undefined,
    disabled: boolean,
  ): void;
}

function formatTimestamp(updatedAtMs: number | undefined): string {
  if (updatedAtMs === undefined || Number.isNaN(updatedAtMs)) {
    return "";
  }
  return new Date(updatedAtMs).toLocaleString();
}

/**
 * Dedicated History page content: one entry per previous conversation, newest
 * first. Opening an entry loads that conversation through the existing
 * SELECT_SESSION / transcript mechanism — no new data source.
 */
export function createHistoryList(
  root: HTMLElement,
  handlers: {
    onOpen: (sessionId: string) => void;
    onNew: () => void;
  },
): HistoryListHandle {
  root.replaceChildren();
  let lastKey = "";

  return {
    update(sessions, activeSessionId, disabled) {
      const key = JSON.stringify([sessions, activeSessionId, disabled]);
      if (key === lastKey) {
        return;
      }
      lastKey = key;

      root.replaceChildren();
      if (sessions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No previous conversations yet.";
        root.appendChild(empty);
        return;
      }

      const list = document.createElement("ul");
      list.className = "history-items";
      for (const session of sessions) {
        const item = document.createElement("li");
        item.className = "history-item";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "history-open";
        button.disabled = disabled;

        const title = document.createElement("span");
        title.className = "history-title";
        title.textContent = session.currentTask ?? "Untitled conversation";

        const meta = document.createElement("span");
        meta.className = "history-meta";
        const parts = [
          formatTimestamp(session.updatedAt),
          session.status.toLowerCase(),
        ].filter((part) => part.length > 0);
        meta.textContent = parts.join(" · ");

        button.append(title, meta);
        button.addEventListener("click", () => handlers.onOpen(session.sessionId));
        if (session.sessionId === activeSessionId) {
          button.classList.add("is-active");
        }
        item.appendChild(button);
        list.appendChild(item);
      }
      root.appendChild(list);

      const newButton = document.createElement("button");
      newButton.type = "button";
      newButton.className = "btn btn-ghost history-new";
      newButton.textContent = "Start a new conversation";
      newButton.onclick = handlers.onNew;
      root.appendChild(newButton);
    },
  };
}
