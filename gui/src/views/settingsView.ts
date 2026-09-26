import { renderProviderSettings } from "../components/providerSettings";
import type { AppState } from "../state";
import type { LocalProvider, RuntimeProvider } from "../protocol";

export function renderSettingsView(
  root: HTMLElement,
  feedbackRoot: HTMLElement,
  state: AppState,
  handlers: {
    onProvider: (provider: RuntimeProvider) => void;
    onCursorConnect: (apiKey: string) => void;
    onCursorDisconnect: () => void;
    onOpenRouterConnect: (apiKey: string) => void;
    onOpenRouterDisconnect: () => void;
    onRefreshOpenRouter: () => void;
    onOpenRouterModel: (modelId: string) => void;
    onOpenRouterSearch: (query: string) => void;
    onLocalProvider: (provider: LocalProvider) => void;
    onRefreshLocal: () => void;
    onLocalConnect: (baseUrl: string, apiKey: string, modelId: string) => void;
    onLocalModel: (modelId: string) => void;
    onMock: () => void;
  },
): void {
  renderProviderSettings(root, state, handlers);
  const text = state.authError ?? state.runtimeError ?? state.authMessage;
  feedbackRoot.hidden = !text;
  feedbackRoot.textContent = text ?? "";
  feedbackRoot.classList.toggle("is-error", Boolean(state.authError || state.runtimeError));
}
