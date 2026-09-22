import type { SessionListItem } from "../protocol";

export function renderSessionBar(
  root: HTMLElement,
  sessions: readonly SessionListItem[],
  activeSessionId: string | undefined,
  disabled: boolean,
  onSelect: (sessionId: string) => void,
  onCreate: () => void,
): void {
  root.replaceChildren();
  const label = document.createElement("span");
  label.className = "session-label";
  label.textContent = sessions.length ? "Session" : "New conversation";
  root.appendChild(label);

  const select = document.createElement("select");
  select.disabled = disabled || sessions.length === 0;
  if (sessions.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No session yet";
    option.value = "";
    select.appendChild(option);
  } else {
    for (const session of sessions) {
      const option = document.createElement("option");
      option.value = session.sessionId;
      option.textContent = session.currentTask ?? session.workspacePath;
      option.selected = session.sessionId === activeSessionId;
      select.appendChild(option);
    }
  }
  select.addEventListener("change", () => select.value && onSelect(select.value));

  const create = document.createElement("button");
  create.className = "btn btn-ghost";
  create.type = "button";
  create.textContent = "New";
  create.disabled = disabled;
  create.addEventListener("click", onCreate);
  root.append(select, create);
}
