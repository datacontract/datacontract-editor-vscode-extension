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

function resolveNpx(): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.resolve('npx');
  }
  // VS Code on Windows may inherit a PATH that doesn't include the Node.js directory.
  // Use `where` (always in System32) to locate npx.cmd, then fall back to common paths.
  return new Promise((resolve) => {
    const probe = spawn('where', ['npx.cmd'], { shell: true });
    let found = '';
    probe.stdout?.on('data', (d: Buffer) => { found += d.toString(); });
    probe.on('close', () => {
      const first = found.trim().split(/\r?\n/)[0].trim();
      if (first) {
        outputChannel.appendLine(`[Data Contract Editor] npx resolved to: ${first}`);
        resolve(first);
        return;
      }
      // where failed — try common install locations
      const candidates = [
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs', 'npx.cmd'),
        path.join(process.env['APPDATA'] ?? os.homedir(), 'npm', 'npx.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'npx.cmd'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          outputChannel.appendLine(`[Data Contract Editor] npx resolved to: ${c}`);
          resolve(c);
          return;
        }
      }
      outputChannel.appendLine('[Data Contract Editor] npx not found via where or common paths; falling back to "npx"');
      resolve('npx');
    });
  });
}

async function startServer(
  filePath: string | undefined,
  port: number,
  openIn: 'simpleBrowser' | 'externalBrowser'
): Promise<void> {
  stopServer();

  const npxPath = await resolveNpx();
  const args = buildNpxArgs(filePath, port);
  outputChannel.appendLine(`[Data Contract Editor] Starting: ${npxPath} ${args.join(' ')}`);
  if (filePath) {
    outputChannel.appendLine(`[Data Contract Editor] File: ${filePath}`);
  }

  const dir = getBrowserSuppressDir();
  // Use forward slashes and quote the path so NODE_OPTIONS survives spaces in usernames
  const suppressScript = dir.replace(/\\/g, '/') + '/suppress-browser.cjs';
  // Append to any existing NODE_OPTIONS so we don't clobber user settings
  const nodeOptions = `${(process.env['NODE_OPTIONS'] ?? '').trim()} --require "${suppressScript}"`.trim();

  const extraEnv: Record<string, string> = { BROWSER: 'none', NODE_OPTIONS: nodeOptions };
  if (process.platform === 'win32') {
    // VS Code may not have the Node.js directory in its PATH. Since we already resolved
    // the absolute path to npx.cmd, node.exe is in the same directory — prepend it.
    // Find the actual key name Windows uses ("Path", not "PATH") to avoid duplicate keys.
    const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'Path';
    const nodeDir = path.dirname(npxPath);
    extraEnv[pathKey] = `${nodeDir}${path.delimiter}${process.env[pathKey] ?? ''}`;
  } else {
    // Prepend no-op shell stubs dir so xdg-open / wslview resolve to our stubs
    extraEnv['PATH'] = `${dir}${path.delimiter}${process.env['PATH'] ?? ''}`;
  }

  // On Windows, .cmd files require cmd.exe to execute — use it explicitly with the
  // resolved absolute path so we are independent of whatever PATH VS Code inherited.
  const [spawnCmd, spawnArgs] =
    process.platform === 'win32'
      ? (['cmd.exe', ['/c', npxPath, ...args]] as const)
      : (['npx', args] as const);

  serverProcess = spawn(spawnCmd, spawnArgs, {
    shell: process.platform !== 'win32',
    cwd: filePath ? path.dirname(filePath) : undefined,
    env: { ...process.env, ...extraEnv },
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

function killProcessTree(proc: ChildProcess): void {
  if (process.platform === 'win32' && proc.pid !== undefined) {
    // proc.kill() only kills the cmd.exe wrapper; the child node.exe survives and
    // keeps the port bound. taskkill /T terminates the entire process tree.
    spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
  } else {
    proc.kill();
  }
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
    killProcessTree(serverProcess);
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

  // No-op shell wrappers for PATH-based lookup on non-WSL Linux (not needed on Windows)
  if (process.platform !== 'win32') {
    const noop = '#!/bin/sh\nexit 0\n';
    for (const name of ['xdg-open', 'wslview', 'sensible-browser', 'gnome-open']) {
      fs.writeFileSync(path.join(dir, name), noop, { mode: 0o755 });
    }
  }

  // Preload script injected via NODE_OPTIONS=--require.
  // Patches child_process.spawn before any module code runs, so when the `open`
  // npm package calls spawn('powershell.exe', ...) or spawn('cmd /c start', ...) or
  // spawn('xdg-open', ...) to open the browser, we silently replace it with a no-op.
  fs.writeFileSync(
    path.join(dir, 'suppress-browser.cjs'),
    `'use strict';
const cp = require('child_process');
const _spawn = cp.spawn.bind(cp);
const isWin = process.platform === 'win32';
// On Windows the no-op is "cmd /c exit 0"; on POSIX it is "/bin/true"
const NOOP = isWin ? ['cmd.exe', ['/c', 'exit', '0']] : ['/bin/true', []];
const BLOCKED = ['powershell', 'wslview', 'xdg-open', 'explorer.exe', 'sensible-browser', 'gnome-open'];
cp.spawn = function(cmd, args, opts) {
  if (typeof cmd === 'string') {
    const c = cmd.toLowerCase();
    if (BLOCKED.some(b => c.includes(b))) {
      return _spawn(NOOP[0], NOOP[1], { stdio: 'ignore', detached: true });
    }
    // On Windows, the 'open' package uses: cmd.exe /c start "" <url>
    if (isWin && (c === 'cmd' || c.endsWith('\\\\cmd.exe')) && Array.isArray(args) && args.includes('start')) {
      return _spawn(NOOP[0], NOOP[1], { stdio: 'ignore', detached: true });
    }
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
