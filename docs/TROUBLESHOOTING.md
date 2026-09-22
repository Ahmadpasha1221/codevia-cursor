# Troubleshooting

## Extension does not activate

* Check the VS Code Output panel for Codevia Cursor logs.
* Verify the extension is enabled in the Extensions view.
* Confirm the activation commands are registered.

## Cursor authentication fails

* Verify the API key is valid in the Cursor dashboard.
* Check that the key is not expired or revoked.
* Inspect logs for authentication errors; API keys are never logged.

## Agent does not start

* Confirm Node.js >=22.13 is installed.
* Confirm `@cursor/sdk` native binaries are present for your platform.
* Check workspace trust settings.

## Webview is blank

* Reload the VS Code window.
* Check for CSP or bundle errors in the webview developer tools.
* Ensure the extension host is running.

## Tests fail

* Run `pnpm run typecheck` first.
* Run `pnpm run lint` to catch style issues.
* Run `pnpm run test` for unit tests.
* For integration tests, ensure no other VS Code instance is running on Linux/Xvfb environments.
