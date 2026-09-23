import { renderComposer } from "../components/composer";
import { renderMessageList } from "../components/messageList";
import type { AppState } from "../state";

export function renderChatView(
  roots: { messages: HTMLElement; composer: HTMLElement },
  state: AppState,
  handlers: {
    onSend: (prompt: string) => void;
    onCancel: () => void;
    onRetry?: () => void;
    onAllowPermission?: (requestId: string) => void;
    onDenyPermission?: (requestId: string) => void;
  },
): void {
  const ready =
    state.runtimeConnected
    || state.provider === "mock"
    || (state.provider === "local" && Boolean(state.selectedModelId) && !state.runtimeError);
  renderMessageList(roots.messages, state.messages, {
    onAllowPermission: handlers.onAllowPermission,
    onDenyPermission: handlers.onDenyPermission,
  });
  renderComposer(roots.composer, {
    disabled: !ready || !state.activeSessionId,
    running: state.running,
    canRetry: Boolean(state.lastPrompt) && !state.running,
    onSend: handlers.onSend,
    onCancel: handlers.onCancel,
    onRetry: handlers.onRetry,
  });
}
