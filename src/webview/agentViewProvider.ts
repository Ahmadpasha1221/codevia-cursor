import * as vscode from "vscode";
import { AgentManager } from "../agent/agentManager";
import { AgentEvent } from "../agent/agentEvents";
import { MessageRouter } from "./messageRouter";
import { ExtensionMessage } from "./types";

export class AgentViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private messageSubscription?: vscode.Disposable;
  private eventSubscription?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agentManager: AgentManager,
    private readonly messageRouter: MessageRouter,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.disposeSubscriptions();
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = getWebviewContent();

    this.messageSubscription = webviewView.webview.onDidReceiveMessage((message: unknown) => {
      this.messageRouter.handleMessage(message).then(
        () => {
          this.postSessionList();
        },
        (error) => {
          this.postMessage({ type: "AGENT_ERROR", error: String(error) });
        },
      );
    });

    this.eventSubscription = this.agentManager.onDidPublishEvent((event: AgentEvent) => {
      const extensionMessage = this.messageRouter.toExtensionMessage(event);
      if (extensionMessage) {
        this.postMessage(extensionMessage);
      }
      this.postSessionList();
    });

    this.postSessionList();
  }

  postMessage(message: ExtensionMessage): void {
    const promise = this.view?.webview.postMessage(message);
    if (promise) {
      promise.then(() => { }, () => { });
    }
  }

  dispose(): void {
    this.disposeSubscriptions();
    this.view = undefined;
  }

  private postSessionList(): void {
    this.postMessage({ type: "SESSION_UPDATED", sessions: this.agentManager.listSessions() });
  }

  private disposeSubscriptions(): void {
    this.messageSubscription?.dispose();
    this.eventSubscription?.dispose();
    this.messageSubscription = undefined;
    this.eventSubscription = undefined;
  }
}

function getWebviewContent(): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codevia Cursor Agent</title>
  <style>
    :root { --accent: #7C3AED; --bg: #1e1e1e; --surface: #252526; --text: #cccccc; --error: #f44747; --thinking: #6b7280; }
    body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; margin: 0; padding: 12px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
    h1 { color: var(--accent); font-size: 16px; margin: 0 0 8px; }
    #status { color: var(--accent); font-size: 12px; margin-bottom: 8px; min-height: 18px; }
    #session-bar { display: flex; gap: 6px; margin-bottom: 8px; align-items: center; }
    #session-select { flex: 1; padding: 6px; background: var(--surface); color: var(--text); border: 1px solid #444; border-radius: 4px; }
    #messages { flex: 1; overflow-y: auto; background: var(--surface); border-radius: 6px; padding: 8px; margin-bottom: 8px; min-height: 0; }
    .msg { margin-bottom: 4px; padding: 4px 6px; border-radius: 3px; word-wrap: break-word; }
    .msg-thinking { color: var(--thinking); font-style: italic; }
    .msg-error { color: var(--error); }
    .msg-tool { background: rgba(124,58,237,0.15); border-left: 3px solid var(--accent); }
    #input-row { display: flex; gap: 6px; }
    #input { flex: 1; padding: 8px; box-sizing: border-box; border: 1px solid #444; border-radius: 4px; background: var(--surface); color: var(--text); }
    button { background: var(--accent); color: #fff; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #cancel-btn { background: #555; }
  </style>
</head>
<body>
  <h1>Codevia Cursor Agent</h1>
  <div id="status">Ready</div>
  <div id="session-bar">
    <select id="session-select"></select>
    <button id="new-session-btn" onclick="newSession()">New</button>
  </div>
  <div id="messages"></div>
  <div id="input-row">
    <input id="input" type="text" placeholder="Ask the agent..." />
    <button id="send-btn" onclick="send()">Send</button>
    <button id="cancel-btn" onclick="cancel()" disabled>Cancel</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const status = document.getElementById('status');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const sessionSelect = document.getElementById('session-select');
    let running = false;

    function addMsg(text, cls) {
      const el = document.createElement('div');
      el.className = 'msg' + (cls ? ' ' + cls : '');
      el.textContent = text;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    function setRunning(isRunning) {
      running = isRunning;
      sendBtn.disabled = isRunning;
      input.disabled = isRunning;
      cancelBtn.disabled = !isRunning;
      status.textContent = isRunning ? 'Running...' : 'Ready';
    }

    function refreshSessions() {
      vscode.postMessage({ type: 'LIST_SESSIONS' });
    }

    function updateSessionList(sessions) {
      sessionSelect.innerHTML = '';
      if (!Array.isArray(sessions)) return;
      for (const s of sessions) {
        const opt = document.createElement('option');
        opt.value = s.sessionId;
        opt.textContent = (s.currentTask || s.workspacePath) + ' — ' + s.status;
        sessionSelect.appendChild(opt);
      }
      sendBtn.disabled = running || sessions.length === 0;
    }

    sessionSelect.addEventListener('change', function() {
      vscode.postMessage({ type: 'SELECT_SESSION', sessionId: sessionSelect.value });
    });

    function send() {
      const prompt = input.value.trim();
      if (!prompt || !sessionSelect.value) return;
      vscode.postMessage({ type: 'SEND_PROMPT', prompt: prompt, sessionId: sessionSelect.value });
      addMsg('You: ' + prompt, '');
      input.value = '';
      setRunning(true);
    }

    function cancel() {
      if (!sessionSelect.value) return;
      vscode.postMessage({ type: 'CANCEL_RUN', sessionId: sessionSelect.value });
    }

    function newSession() {
      vscode.postMessage({ type: 'NEW_SESSION' });
    }

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !running) {
        send();
      }
    });

    window.addEventListener('message', event => {
      const data = event.data;
      switch (data.type) {
        case 'AGENT_STATE':
          status.textContent = 'State: ' + data.state;
          if (data.state === 'completed' || data.state === 'cancelled' || data.state === 'failed' || data.state === 'disconnected') {
            setRunning(false);
          }
          break;
        case 'AGENT_MESSAGE':
          addMsg(data.message, '');
          break;
        case 'AGENT_THINKING':
          addMsg(data.message, 'msg-thinking');
          break;
        case 'AGENT_TOOL_CALL':
          addMsg('Tool: ' + (data.toolCall && data.toolCall.toolName ? data.toolCall.toolName : 'unknown'), 'msg-tool');
          break;
        case 'AGENT_TOOL_RESULT':
          addMsg('Tool result: ' + (data.result && data.result.toolName ? data.result.toolName : 'unknown'), 'msg-tool');
          break;
        case 'AGENT_ERROR':
          addMsg('Error: ' + data.error, 'msg-error');
          setRunning(false);
          break;
        case 'PERMISSION_REQUEST':
          addMsg('Permission: ' + data.message, 'msg-error');
          break;
        case 'SESSION_UPDATED':
          updateSessionList(data.sessions);
          break;
      }
    });

    refreshSessions();
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
