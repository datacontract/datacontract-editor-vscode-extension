# Changelog

All notable changes to this extension will be documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.5] - 2026-06-05

### Changed
- Updated repository metadata to the new GitHub location under the `datacontract` organization.
- Updated CI and CodeQL badge links in `README.md` to the new repository location.

### Fixed
- Replaced the retired Visual Studio Marketplace badge endpoint with a maintained provider so the version badge renders correctly in `README.md`.

### Dependencies
- Bumped development dependencies via Dependabot update PRs.

## [0.1.4] - 2026-05-06

### Fixed
- Webview showed an empty tab when the extension was used inside a devcontainer or over Remote SSH. The iframe URL is now resolved through `vscode.env.asExternalUri()`, which registers the port with VS Code's forwarding mechanism and returns the URL the webview renderer can actually reach. No change in behaviour for plain local VS Code.

## [0.1.3] - 2026-05-06

### Added
- New setting `datacontractEditor.packageVersion`: pin the `datacontract-editor` npm package to a specific version (e.g. `0.1.4`) instead of always pulling `latest`. Useful for reproducible installs or compatibility with older Node.js runtimes.

## [0.1.2] - 2026-05-05

### Added
- New setting `datacontractEditor.schemaFile`: set an absolute path to a custom ODCS JSON Schema file to use for validation instead of the default public schema. Implemented by intercepting the local server's HTTP responses to inject the custom schema URL, with no changes required to the `datacontract-editor` package.
- Opening a different data contract while the editor is already active now restarts the server with the new file instead of silently staying on the previous one.

### Fixed
- On Windows, closing the editor panel no longer leaves the background Node.js server process running. The extension now uses `taskkill /F /T` to terminate the entire process tree, so the port is properly released and a second data contract can be opened in the same VS Code session.
- On Linux/WSL, the same orphaned-process problem is fixed by spawning the server in its own process group (`detached: true`) and sending `SIGTERM` to the entire group, ensuring the `npx → node` child chain is fully terminated. A port-availability poll (up to 5 s) guards against any remaining timing gap before the next server starts.

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
