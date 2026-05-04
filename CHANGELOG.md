# Changelog

All notable changes to this extension will be documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - Unreleased

### Added
- Command **"Open in Data Contract Editor"** accessible from the Command Palette, editor title bar, and Explorer context menu for `.yaml` / `.yml` files
- Command **"Stop Data Contract Editor Server"** to shut down the local server on demand
- First-run QuickPick to choose whether the editor opens inside VS Code (embedded webview) or in the system browser; preference is saved to settings
- Closing the embedded webview panel automatically stops the local server
- Status bar indicator while the server is running; click to re-open the panel
- Configurable port via `datacontractEditor.port` (default `9090`)
- Configurable open location via `datacontractEditor.openIn` (`simpleBrowser` | `externalBrowser`)
- Output channel **"Data Contract Editor"** for server logs and diagnostics
