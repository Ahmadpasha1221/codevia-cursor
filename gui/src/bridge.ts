import type { GuiToHost, HostToGui } from "./protocol";

interface VsCodeApi {
  postMessage(message: GuiToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postToHost(message: GuiToHost): void {
  vscode.postMessage(message);
}

export function onHostMessage(handler: (message: HostToGui) => void): void {
  window.addEventListener("message", (event: MessageEvent<HostToGui>) => {
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") {
      return;
    }
    handler(data);
  });
}
