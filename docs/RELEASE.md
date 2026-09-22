# Release Process

## Pre-release checklist

* Update `CHANGELOG.md` with user-facing changes.
* Update version in `package.json` using SemVer.
* Run `pnpm install`.
* Run `pnpm run typecheck`.
* Run `pnpm run lint`.
* Run `pnpm run test`.
* Run `pnpm run compile`.
* Package VSIX with `pnpm run package`.
* Inspect VSIX contents.
* Test fresh installation.
* Test upgrade path.
* Verify README, icon, and Marketplace metadata.

## Publishing

* Use `@vscode/vsce` to publish.
* Never publish broken builds.
* CI must pass before release.
* Release notes should map to `CHANGELOG.md` entries.
