import { renderComposer } from "../components/composer";
import { renderMessageList } from "../components/messageList";
import { renderSessionBar } from "../components/sessionBar";
import type { AppState } from "../state";

export function renderChatView(
  roots: { sessionBar: HTMLElement; messages: HTMLElement; composer: HTMLElement },
  state: AppState,
  handlers: {
    onSelectSession: (sessionId: string) => void;
    onNewSession: () => void;
    onSend: (prompt: string) => void;
    onCancel: () => void;
  },
): void {
  const ready = state.runtimeConnected || state.provider === "mock";
  renderSessionBar(roots.sessionBar, state.sessions, state.activeSessionId, !ready, handlers.onSelectSession, handlers.onNewSession);
  renderMessageList(roots.messages, state.messages);
  renderComposer(roots.composer, {
    disabled: !ready || !state.activeSessionId,
    running: state.running,
    onSend: handlers.onSend,
    onCancel: handlers.onCancel,
  });
}
