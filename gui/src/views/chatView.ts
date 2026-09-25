import type { ComposerHandle } from "../components/composer";
import type { AppState } from "../state";

/**
 * The chat view owns no DOM of its own anymore: the composer and message list
 * are persistent components updated in place, so re-renders never destroy the
 * elements the user is interacting with.
 */
export function renderChatView(
  roots: { composer: ComposerHandle },
  state: AppState,
  _handlers: Record<string, never>,
): void {
  const ready =
    state.runtimeConnected
    || state.provider === "mock"
    || (state.provider === "local" && Boolean(state.selectedModelId) && !state.runtimeError);
  roots.composer.update({
    disabled: !ready || !state.activeSessionId,
    running: state.running,
    canRetry: Boolean(state.lastPrompt) && !state.running,
    readyForInput: ready,
  });
}
