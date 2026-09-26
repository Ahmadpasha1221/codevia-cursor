# Spider

Spider is an independent VS Code extension that provides an AI coding-agent experience inside VS Code. It can run against:

* Cursor local agents through the official TypeScript SDK (`@cursor/sdk`)
* Local models already installed on your machine through [Ollama](https://ollama.com)
* OpenAI-compatible local servers such as LM Studio
* Cloud models through [OpenRouter](https://openrouter.ai) with live model discovery

This extension is not affiliated with Cursor. Cursor is a trademark of Cursor, Inc.

## Features

* Chat with Ollama models from the Spider sidebar (for example `qwen2.5:0.5b-instruct`)
* OpenRouter provider: live model discovery with metadata (context length, tool-calling and vision capability, pricing), searchable model picker, and secure API-key storage
* Optional Cursor agent integration through `@cursor/sdk`
* Secure Cursor API key storage with VS Code `SecretStorage`
* Mock runtime for UI testing without a network model
* Typed webview messaging and strict CSP
* Session and task management with a dedicated History page of previous conversations
* Chat transcripts persist across restarts — history is restored from local storage without re-sending it to the model, so restoring costs zero tokens
* Permission handling for destructive operations

## Requirements

* VS Code 1.95.0 or later
* Node.js 22.13 or later

For **local models**:

* [Ollama](https://ollama.com) installed and running
* At least one pulled model, for example `ollama pull qwen2.5:0.5b-instruct`

For **OpenRouter**:

* An OpenRouter API key from https://openrouter.ai/keys

For **Cursor**:

* A Cursor user API key from https://cursor.com/dashboard/api
* A Cursor plan that includes the Cursor SDK

## Installation

1. Install the extension from a VSIX or the marketplace.
2. Open the Command Palette and run `Spider: Open Agent`.
3. Open **Settings** in the Spider sidebar.
4. Choose a provider:
   * **Local AI** → Ollama. Spider lists models from `http://127.0.0.1:11434` and chats with the selected model.
   * **OpenRouter** → paste your API key, then Save and connect. Spider loads the live model catalog and you pick a model.
   * **Cursor** → paste your API key, then Save and connect.
   * **Mock / Test** → exercise the UI without a model.

## Local Ollama

1. Start Ollama (`ollama serve` if it is not already running).
2. Pull a model: `ollama pull qwen2.5:0.5b-instruct`.
3. In Spider Settings, set **AI provider** to **Local AI** and **Local provider** to **Ollama**.
4. Click **Refresh models**, select a model, then **Use this model**.
5. Return to chat and send a prompt.

Spider talks to the local Ollama HTTP API only. It does not upload those prompts to Cursor.

## OpenRouter

1. In Spider Settings, set **AI provider** to **OpenRouter**.
2. Paste your API key and click **Save and connect**. The key is stored in VS Code `SecretStorage` and is never logged or displayed.
3. Spider fetches the live catalog from `https://openrouter.ai/api/v1/models` and fills the model dropdown — no hardcoded model list.
4. Filter models by name or ID, pick one, and start chatting. Use **Refresh models** to re-fetch the catalog at any time without restarting.
5. Model metadata is shown in the dropdown and under the picker: name, model ID, context length, tool-calling and vision capability, and per-million-token pricing when the catalog provides it. Tool calling is enabled from the selected model's capability metadata, not from model-name checks.

## Development setup

```bash
pnpm install
pnpm run compile
pnpm run test
```

## Testing

* Unit tests: `pnpm run test`
* Integration tests: `pnpm run test:integration`

## Security

Cursor API keys are stored only in VS Code `SecretStorage`. They are never logged, committed, or sent to any server except Cursor when you choose the Cursor provider. OpenRouter API keys are likewise stored only in VS Code `SecretStorage` and are only ever sent to `https://openrouter.ai` as a bearer token when you choose the OpenRouter provider. See `docs/SECURITY.md` for details.

## Troubleshooting

* **Ollama not connected**: confirm `ollama list` works and `http://127.0.0.1:11434/api/tags` responds.
* **No models detected**: pull a model, then click Refresh models.
* **OpenRouter: "OpenRouter rejected the API key"**: re-check the key at https://openrouter.ai/keys, paste it again, and Save and connect.
* **OpenRouter: "rate limit reached"**: wait a moment and click Refresh models.
* **OpenRouter: "unreachable"**: check your network connection, then Refresh models.
* Cursor SDK errors: see `docs/TROUBLESHOOTING.md`.

## License

MIT
MIT
