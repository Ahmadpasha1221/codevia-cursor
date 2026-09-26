# API

## Extension host messages

### Webview → Extension

* `SEND_PROMPT`
* `CANCEL_RUN`
* `NEW_SESSION`
* `SELECT_SESSION`
* `STOP_AGENT`
* `CONNECT_CURSOR`
* `DISCONNECT_CURSOR`
* `OPEN_FILE`
* `APPROVE_PERMISSION`
* `DENY_PERMISSION`

### Extension → Webview

* `AGENT_STATE`
* `AGENT_MESSAGE`
* `AGENT_TOOL_CALL`
* `AGENT_TOOL_RESULT`
* `AGENT_ERROR`
* `PERMISSION_REQUEST`
* `SESSION_UPDATED`
* `AUTH_STATUS`
* `RUN_STARTED`
* `RUN_COMPLETED`

## Cursor SDK usage

The extension uses the official `@cursor/sdk` APIs:

* `Agent.create({ apiKey, model: { id }, local: { cwd } })`
* `Agent.resume(agentId, options)`
* `agent.send(prompt)`
* `run.stream()`
* `run.cancel()`
* `Agent.list({ runtime: "local", cwd })`
* `Cursor.models.list()`
* `Cursor.auth.login()` and `Cursor.auth.status()`

## Typed message validation

All webview messages are validated against discriminated unions before reaching extension services. Unknown message shapes are rejected with a user-safe error.
