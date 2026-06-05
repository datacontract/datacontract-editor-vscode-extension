# Data Contract Editor for VS Code

[![CI](https://github.com/datacontract/datacontract-editor-vscode-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/datacontract/datacontract-editor-vscode-extension/actions/workflows/ci.yml)
[![CodeQL](https://github.com/datacontract/datacontract-editor-vscode-extension/actions/workflows/codeql.yml/badge.svg)](https://github.com/datacontract/datacontract-editor-vscode-extension/actions/workflows/codeql.yml)
[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version/gkoenig.vscode-datacontract-editor.svg)](https://marketplace.visualstudio.com/items?itemName=gkoenig.vscode-datacontract-editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Opens [ODCS](https://datacontract.com/)-compliant data contracts in the [Data Contract Editor](https://github.com/datacontract/datacontract-editor) inside VS Code.

The editor provides a rich UI with Monaco-based YAML editing, schema validation, and graph visualization — all launched on demand as a local server using `npx`. No global install required.

## Why this extension

- Edit ODCS data contracts in a purpose-built visual UI directly in VS Code.
- Avoid global setup by launching Data Contract Editor on demand via `npx`.
- Keep your workflow clean with automatic local server startup and shutdown.

---

## Features

- **One-click editing** — right-click any `.yaml` / `.yml` file and choose *Open in Data Contract Editor*
- **Editor title bar button** — appears automatically when a YAML file is active
- **Command Palette** — run `Data Contract: Open in Data Contract Editor` from anywhere
- **Embedded panel** — editor opens in a VS Code webview panel (or in your system browser if preferred)
- **Status bar indicator** — shows while the server is running; click to re-open the panel
- **Automatic cleanup** — the local server stops when you close the editor panel or shut down VS Code

---

## Requirements

- **Node.js 22+** and **npm** must be installed and available on your `PATH`
- Internet access is required on first use (to download `datacontract-editor` via `npx`); subsequent runs use the npx cache

> **Devcontainer users:** make sure your devcontainer image ships Node.js 22+. You can add `"features": { "ghcr.io/devcontainers/features/node:1": { "version": "22" } }` to your `devcontainer.json`, or switch to a base image that includes Node.js 22 (e.g. `mcr.microsoft.com/devcontainers/javascript-node:22`).

---

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=gkoenig.vscode-datacontract-editor) or search for **"Data Contract Editor"** in the Extensions panel (`Ctrl+Shift+X`).

---

## Usage

### Open a data contract file

1. Right-click a `.yaml` / `.yml` file in the Explorer or while it is open in the editor
2. Select **Open in Data Contract Editor**

Or use the Command Palette (`Ctrl+Shift+P` / `⇧⌘P`):

```
Data Contract: Open in Data Contract Editor
```

On first use you will be asked where the editor should open (saved to settings — change at any time via *Preferences → Settings*):

- **Inside VS Code** — opens as an embedded webview panel next to your editor
- **External Browser** — opens in your default system browser

The extension will start a local server and open the editor. A status bar item (`$(globe) Data Contract Editor`) is shown while the server is running.

> **Tip:** Closing the editor panel also stops the local server.

> **One file at a time:** The extension runs a single local server. Opening a second data contract while one is already open restarts the server with the new file — it is not possible to view two contracts side-by-side in the same VS Code window.

### Stop the server manually

```
Data Contract: Stop Data Contract Editor Server
```

Or simply close the editor panel or VS Code — the server is stopped automatically.

---

## Commands

| Command | Description |
|---|---|
| `Data Contract: Open in Data Contract Editor` | Starts the local server (if needed) and opens the current YAML file in the editor. |
| `Data Contract: Stop Data Contract Editor Server` | Stops the local server and closes the editor panel. |

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `datacontractEditor.port` | number | `4173` | Port for the local server |
| `datacontractEditor.openIn` | `simpleBrowser` \| `externalBrowser` | `simpleBrowser` | Where to open the editor (set on first use via prompt) |
| `datacontractEditor.schemaFile` | string | `""` | Absolute path to a custom ODCS JSON Schema file. When set, overrides the default public ODCS schema used for validation. |
| `datacontractEditor.packageVersion` | string | `"latest"` | Version of the `datacontract-editor` npm package to use. Pin to a specific version (e.g. `0.1.4`) for compatibility with older Node.js runtimes or for reproducible installs. |

---

## Troubleshooting

**"Failed to start: ENOENT"**
Node.js / npm is not on your PATH. Install Node.js from [nodejs.org](https://nodejs.org) and restart VS Code.

**"Node.js 22 or later is required"**
Your system or devcontainer has an older Node.js. Upgrade to Node.js 22+:
- **Local machine:** use [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22 && nvm use 22`) or download from [nodejs.org](https://nodejs.org).
- **Devcontainer:** add `"ghcr.io/devcontainers/features/node:1": { "version": "22" }` to your `devcontainer.json` features and rebuild the container.

**Port already in use**
Another process is using the configured port. Stop it (`lsof -ti :4173 | xargs kill`) or change `datacontractEditor.port` in settings.

**Server logs**
Open the Output panel (`View → Output`) and select **Data Contract Editor** from the dropdown for detailed server output.

---

## Known issues

- One VS Code window supports one running Data Contract Editor server instance at a time.
- Opening a second contract while one is already open restarts the server with the new file.

---

## Release notes

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Contributing

Contributions are welcome! Please open an issue before submitting a large pull request.

```bash
git clone https://github.com/datacontract/datacontract-editor-vscode-extension.git
cd datacontract-editor-vscode-extension
npm install
```

Open the folder in VS Code and press **F5** to launch an Extension Development Host with the extension loaded.
Run `npm run watch` in a terminal to rebuild automatically on changes.

### Project structure

| Path | Purpose |
|---|---|
| `src/extension.ts` | All extension logic |
| `esbuild.js` | Build script (TypeScript → `dist/extension.js`) |
| `package.json` | Extension manifest and npm scripts |

### npm scripts

| Script | Description |
|---|---|
| `npm run build` | One-shot build |
| `npm run watch` | Rebuild on every save |
| `npm run package` | Produce a `.vsix` for local testing |
| `npm run publish` | Publish to the VS Code Marketplace |

---

## License

[MIT](LICENSE)
