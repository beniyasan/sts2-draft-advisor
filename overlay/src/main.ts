import { app, BrowserWindow, globalShortcut, ipcMain, net, protocol, shell } from "electron";
import { createConnection, Socket } from "node:net";
import { createWriteStream } from "node:fs";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { CodexAppServerClient } from "./services/codexAppServer";
import { CodexContextService } from "./services/codexContext";
import { GameState } from "./shared/protocol";

const pipePath = process.platform === "win32" ? "\\\\.\\pipe\\DraftAdvisor.v1" : "/tmp/DraftAdvisor.v1";
const assetsRoot = join(__dirname, "..", "assets", "live2d");

// Persisted log: the overlay is normally started detached, so console output
// would be invisible when troubleshooting.
const logStream = createWriteStream(join(__dirname, "..", "overlay.log"), { flags: "a" });
function log(line: string): void {
  const entry = `[${new Date().toISOString()}] ${line}`;
  try { console.log(entry); } catch { }
  logStream.write(entry + "\n");
}

if (process.env.WSL_DISTRO_NAME)
  log("WARNING: running inside WSL — the overlay cannot reach the game's named pipe. Run it on Windows.");

// Local scheme serving bundled Live2D assets; fetch() works over it.
protocol.registerSchemesAsPrivileged([
  { scheme: "live2d", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let windowRef: BrowserWindow | null = null;
let pipe: PipeClient | null = null;
let codex: CodexAppServerClient | null = null;
let context: CodexContextService | null = null;
let latestState: GameState | null = null;

class PipeClient extends EventEmitter {
  private socket: Socket | null = null; private buffer = ""; private stopped = false; private reconnecting = false;
  start(): void { this.stopped = false; this.connect(); }
  stop(): void { this.stopped = true; this.socket?.destroy(); this.socket = null; }
  requestState(): void { this.send({ type: "request_state" }); }
  private connect(): void {
    if (this.stopped) return;
    const socket = createConnection(pipePath); this.socket = socket; socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.read(chunk));
    socket.on("connect", () => { this.reconnecting = false; this.emit("connection", true); });
    socket.on("error", () => this.reconnect()); socket.on("close", () => this.reconnect());
  }
  private read(chunk: string): void {
    this.buffer += chunk; let end = this.buffer.indexOf("\n");
    while (end >= 0) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      if (line) {
        try {
          const value = JSON.parse(line);
          if (value.type === "game_state") this.emit("state", value as GameState);
          else if (value.type === "toggle_window") this.emit("toggle");
        } catch { }
      }
      end = this.buffer.indexOf("\n");
    }
  }
  private send(message: object): void { if (this.socket && !this.socket.destroyed) this.socket.write(`${JSON.stringify(message)}\n`); }
  private reconnect(): void {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true; this.emit("connection", false); this.socket?.destroy(); this.socket = null;
    setTimeout(() => { this.reconnecting = false; this.connect(); }, 1000);
  }
}

function sendRenderer(channel: string, value?: unknown): void { if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send(channel, value); }

function toggleWindow(): void {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (windowRef.isMinimized()) windowRef.restore();
  else if (windowRef.isVisible()) windowRef.minimize();
  else windowRef.show();
  windowRef.focus();
}

function createWindow(): void {
  const transparent = !process.env.OVERLAY_OPAQUE;
  windowRef = new BrowserWindow({ width: 520, height: 720, minWidth: 360, minHeight: 420, frame: false, transparent, alwaysOnTop: true, resizable: true, skipTaskbar: false, show: false,
    backgroundColor: transparent ? "#00000000" : "#17120f",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  windowRef.once("ready-to-show", () => windowRef?.show());
  void windowRef.loadFile(join(__dirname, "renderer", "index.html")).catch(error => log(`Overlay UI failed to load: ${error}`));
  windowRef.webContents.on("did-fail-load", (_e, code, desc) => log(`load failed: ${code} ${desc}`));
  windowRef.webContents.on("console-message", (_e, _level, message) => log(`renderer: ${message}`));
  windowRef.on("closed", () => { windowRef = null; });
  // Diagnostics: OVERLAY_SHOT_DIR=/path writes a screenshot ~4s after load.
  const shotDir = process.env.OVERLAY_SHOT_DIR;
  if (shotDir) windowRef.webContents.once("did-finish-load", () => setTimeout(async () => {
    try {
      const image = await windowRef?.webContents.capturePage();
      if (image) { const { writeFileSync } = await import("node:fs"); writeFileSync(join(shotDir, "overlay-shot.png"), image.toPNG()); log(`shot saved: ${shotDir}`); }
    } catch (error) { log(`shot failed: ${error}`); }
  }, 4000));
}

function setupServices(): void {
  pipe = new PipeClient();
  pipe.on("state", (state: GameState) => { latestState = state; sendRenderer("game-state", state); sendRenderer("connection-status", { connected: true }); });
  pipe.on("connection", (connected: boolean) => sendRenderer("connection-status", { connected }));
  pipe.on("toggle", toggleWindow);
  pipe.start(); context = new CodexContextService();
  codex = new CodexAppServerClient({ onDelta: delta => sendRenderer("chat-delta", delta), onCompleted: () => sendRenderer("chat-done"), onStatus: status => sendRenderer("codex-status", status), onAuthUrl: url => void shell.openExternal(url) });
}
async function ask(question: string): Promise<void> {
  if (!codex || !context || !latestState) throw new Error("ゲーム状態がまだ取得できません。");
  await codex.ask(await context.buildPrompt(question, latestState));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { windowRef?.show(); windowRef?.focus(); });
  app.whenReady().then(() => {
    protocol.handle("live2d", request => {
      // live2d://model/<path under assets/live2d>
      const rel = normalize(decodeURIComponent(new URL(request.url).pathname).replace(/^[/\\]+/, ""));
      const file = join(assetsRoot, rel);
      if (!file.startsWith(assetsRoot + sep)) return new Response(null, { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    createWindow(); setupServices();
    const shortcutRegistered = globalShortcut.register("CommandOrControl+Shift+D", toggleWindow);
    log(shortcutRegistered
      ? "Overlay shortcut registered: Ctrl+Shift+D"
      : "Overlay shortcut could not be registered. The in-game toggle (via pipe) still works.");
    ipcMain.handle("ask", (_event, question: string) => ask(question));
    ipcMain.handle("login", async () => codex?.login());
    ipcMain.handle("refresh-state", () => pipe?.requestState());
    ipcMain.handle("minimize-window", () => windowRef?.minimize());
  });
}
app.on("will-quit", () => { globalShortcut.unregisterAll(); pipe?.stop(); codex?.stop(); logStream.end(); });
