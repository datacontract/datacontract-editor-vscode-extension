import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const STARTUP_TIMEOUT_MS = 45_000;

let serverProcess: ChildProcess | undefined;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let currentPort: number | undefined;
let suppressDir: string | undefined;
let webviewPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Data Contract Editor');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.command = 'datacontract-editor.open';
  statusBarItem.hide();

  context.subscriptions.push(
    vscode.commands.registerCommand('datacontract-editor.open', (uri?: vscode.Uri) =>
      openEditor(uri)
    ),
    vscode.commands.registerCommand('datacontract-editor.stop', stopServer),
    statusBarItem,
    outputChannel
  );
}

async function openEditor(uri?: vscode.Uri): Promise<void> {
  const filePath = resolveFilePath(uri);
  const openIn = await resolveOpenIn();
  if (openIn === undefined) {
    return; // user dismissed the QuickPick
  }

  if (serverProcess && !serverProcess.killed && currentPort) {
    await showBrowser(currentPort, openIn);
    return;
  }

  const port = getConfiguredPort();
  await startServer(filePath, port, openIn);
}

function resolveFilePath(uri?: vscode.Uri): string | undefined {
  if (uri?.scheme === 'file') {
    return uri.fsPath;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme === 'file') {
    return editor.document.uri.fsPath;
  }
  return undefined;
}

async function resolveOpenIn(): Promise<'simpleBrowser' | 'externalBrowser' | undefined> {
  const config = vscode.workspace.getConfiguration('datacontractEditor');
  const inspect = config.inspect<string>('openIn');

  // Already explicitly chosen — use it without prompting again
  if (inspect?.globalValue !== undefined || inspect?.workspaceValue !== undefined) {
    return config.get<'simpleBrowser' | 'externalBrowser'>('openIn', 'simpleBrowser');
  }

  // First run: ask the user
  const items = [
    {
      label: '$(window) Inside VS Code',
      description: 'Embedded webview panel (recommended)',
      value: 'simpleBrowser' as const,
    },
    {
      label: '$(link-external) External Browser',
      description: 'Opens in your default system browser',
      value: 'externalBrowser' as const,
    },
  ];

  const choice = await vscode.window.showQuickPick(items, {
    title: 'Data Contract Editor',
    placeHolder: 'Where should the editor open? (saved to settings — change via Preferences any time)',
  });

  if (!choice) {
    return undefined;
  }

  await config.update('openIn', choice.value, vscode.ConfigurationTarget.Global);
  return choice.value;
}

async function startServer(
  filePath: string | undefined,
  port: number,
  openIn: 'simpleBrowser' | 'externalBrowser'
): Promise<void> {
  stopServer();

  const args = buildNpxArgs(filePath, port);
  outputChannel.appendLine(`[Data Contract Editor] Starting: npx ${args.join(' ')}`);
  if (filePath) {
    outputChannel.appendLine(`[Data Contract Editor] File: ${filePath}`);
  }

  const dir = getBrowserSuppressDir();
  const suppressScript = path.join(dir, 'suppress-browser.cjs');
  // Append to any existing NODE_OPTIONS so we don't clobber user settings
  const nodeOptions = `${(process.env['NODE_OPTIONS'] ?? '').trim()} --require ${suppressScript}`.trim();

  serverProcess = spawn('npx', args, {
    shell: true,
    cwd: filePath ? path.dirname(filePath) : undefined,
    env: {
      ...process.env,
      // PATH wrappers catch xdg-open / wslview on non-WSL Linux
      PATH: `${dir}${path.delimiter}${process.env['PATH'] ?? ''}`,
      BROWSER: 'none',
      // Preload script patches child_process.spawn to block powershell.exe / xdg-open
      // before the `open` npm package can invoke them — works on WSL2 and plain Linux
      NODE_OPTIONS: nodeOptions,
    },
  });

  serverProcess.on('error', (err: Error) => {
    const hint = err.message.includes('ENOENT')
      ? ' — make sure Node.js and npm are installed and on your PATH.'
      : '';
    vscode.window.showErrorMessage(
      `Data Contract Editor failed to start: ${err.message}${hint}`
    );
  });

  serverProcess.on('exit', (code: number | null) => {
    outputChannel.appendLine(`[Data Contract Editor] Server exited (code ${code})`);
    if (currentPort !== undefined) {
      setStatus(false, currentPort);
    }
    serverProcess = undefined;
    currentPort = undefined;
  });

  const detectedPort = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Data Contract Editor',
      cancellable: false,
    },
    (progress) => {
      progress.report({ message: 'Starting server…' });
      return waitForServerUrl(serverProcess!, STARTUP_TIMEOUT_MS);
    }
  );

  if (detectedPort !== undefined) {
    currentPort = detectedPort;
    setStatus(true, detectedPort);
    await showBrowser(detectedPort, openIn);
  } else {
    vscode.window
      .showErrorMessage(
        'Data Contract Editor did not start within 45 s. Check the Output panel for details.',
        'Show Output'
      )
      .then((v) => v === 'Show Output' && outputChannel.show());
    stopServer();
  }
}

function waitForServerUrl(proc: ChildProcess, timeoutMs: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    let resolved = false;

    const finish = (port: number | undefined) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      resolve(port);
    };

    const timeoutHandle = setTimeout(() => finish(undefined), timeoutMs);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      outputChannel.append(text);
      if (!resolved) {
        const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (match) {
          finish(parseInt(match[1], 10));
        }
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
  });
}

function stopServer(): void {
  // Null out webviewPanel before disposing to avoid re-entrant calls from onDidDispose
  if (webviewPanel) {
    const panel = webviewPanel;
    webviewPanel = undefined;
    panel.dispose();
  }
  if (serverProcess) {
    outputChannel.appendLine('[Data Contract Editor] Stopping server…');
    serverProcess.kill();
    serverProcess = undefined;
  }
  if (currentPort !== undefined) {
    setStatus(false, currentPort);
    currentPort = undefined;
  }
}

async function showBrowser(
  port: number,
  openIn: 'simpleBrowser' | 'externalBrowser'
): Promise<void> {
  const url = `http://localhost:${port}`;

  if (openIn === 'externalBrowser') {
    await vscode.env.openExternal(vscode.Uri.parse(url));
    return;
  }

  openInWebviewPanel(url);
}

function openInWebviewPanel(url: string): void {
  if (webviewPanel) {
    // Panel already open — just reload the URL and bring it to the front
    webviewPanel.webview.html = buildWebviewHtml(url);
    webviewPanel.reveal();
    return;
  }

  webviewPanel = vscode.window.createWebviewPanel(
    'datacontractEditor',
    'Data Contract Editor',
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  webviewPanel.webview.html = buildWebviewHtml(url);

  // When the user closes the tab, shut down the server too
  webviewPanel.onDidDispose(() => {
    webviewPanel = undefined;
    stopServer();
  });
}

function buildWebviewHtml(url: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; frame-src *; img-src * data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    iframe { display: block; width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe src="${url}"></iframe>
</body>
</html>`;
}

function setStatus(running: boolean, port: number): void {
  if (running) {
    statusBarItem.text = '$(globe) Data Contract Editor';
    statusBarItem.tooltip = `Running at http://localhost:${port} — click to reopen`;
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function getConfiguredPort(): number {
  return vscode.workspace
    .getConfiguration('datacontractEditor')
    .get<number>('port', 9090);
}

function buildNpxArgs(filePath: string | undefined, port: number): string[] {
  // datacontract-editor CLI: -p <port> [file]
  const args = ['--yes', 'datacontract-editor', '-p', String(port)];
  if (filePath) {
    args.push(filePath);
  }
  return args;
}

function getBrowserSuppressDir(): string {
  if (suppressDir) {
    return suppressDir;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dce-noopen-'));

  // No-op shell wrappers for PATH-based lookup on non-WSL Linux
  const noop = '#!/bin/sh\nexit 0\n';
  for (const name of ['xdg-open', 'wslview', 'sensible-browser', 'gnome-open']) {
    fs.writeFileSync(path.join(dir, name), noop, { mode: 0o755 });
  }

  // Preload script injected via NODE_OPTIONS=--require.
  // Patches child_process.spawn before any module code runs, so when the `open`
  // npm package calls spawn('powershell.exe', ...) or spawn('xdg-open', ...) to
  // open the browser, we silently replace it with /bin/true.
  fs.writeFileSync(
    path.join(dir, 'suppress-browser.cjs'),
    `'use strict';
const cp = require('child_process');
const _spawn = cp.spawn.bind(cp);
const BLOCKED = ['powershell', 'wslview', 'xdg-open', 'explorer', 'sensible-browser', 'gnome-open'];
cp.spawn = function(cmd, args, opts) {
  if (typeof cmd === 'string' && BLOCKED.some(b => cmd.toLowerCase().includes(b))) {
    return _spawn('/bin/true', [], { stdio: 'ignore', detached: true });
  }
  return _spawn(cmd, args, opts);
};
`
  );

  suppressDir = dir;
  return dir;
}

export function deactivate(): void {
  stopServer();
  if (suppressDir) {
    try {
      fs.rmSync(suppressDir, { recursive: true, force: true });
    } catch {}
    suppressDir = undefined;
  }
}
