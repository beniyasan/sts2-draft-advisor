import { app, BrowserWindow, globalShortcut, ipcMain, shell } from "electron";
import { createConnection, Socket } from "node:net";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { CodexAppServerClient } from "./services/codexAppServer";
import { CodexContextService } from "./services/codexContext";
import { GameState } from "./shared/protocol";

const pipePath = process.platform === "win32" ? "\\\\.\\pipe\\DraftAdvisor.v1" : "/tmp/DraftAdvisor.v1";
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
      if (line) { try { const value = JSON.parse(line) as GameState; if (value.type === "game_state") this.emit("state", value); } catch { } }
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

function createWindow(): void {
  windowRef = new BrowserWindow({ width: 520, height: 720, minWidth: 360, minHeight: 420, frame: false, transparent: true, alwaysOnTop: true, resizable: true, skipTaskbar: false, show: false,
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  windowRef.once("ready-to-show", () => windowRef?.show());
  void windowRef.loadFile(join(__dirname, "renderer", "index.html")).catch(error => console.error("Overlay UI failed to load:", error));
  windowRef.on("closed", () => { windowRef = null; });
}

function setupServices(): void {
  pipe = new PipeClient();
  pipe.on("state", (state: GameState) => { latestState = state; sendRenderer("game-state", state); sendRenderer("connection-status", { connected: true }); });
  pipe.on("connection", (connected: boolean) => sendRenderer("connection-status", { connected }));
  pipe.start(); context = new CodexContextService();
  codex = new CodexAppServerClient({ onDelta: delta => sendRenderer("chat-delta", delta), onCompleted: () => sendRenderer("chat-done"), onStatus: status => sendRenderer("codex-status", status), onAuthUrl: url => void shell.openExternal(url) });
}
async function ask(question: string): Promise<void> {
  if (!codex || !context || !latestState) throw new Error("ゲーム状態がまだ取得できません。");
  await codex.ask(await context.buildPrompt(question, latestState));
}

app.whenReady().then(() => {
  createWindow(); setupServices();
  const shortcutRegistered = globalShortcut.register("CommandOrControl+Shift+D", () => {
    if (!windowRef) return;
    if (windowRef.isMinimized()) windowRef.restore();
    else if (windowRef.isVisible()) windowRef.minimize();
    else windowRef.show();
    windowRef.focus();
  });
  console.log(shortcutRegistered
    ? "Overlay shortcut registered: Ctrl+Shift+D"
    : "Overlay shortcut could not be registered. Use the taskbar to show the window.");
  ipcMain.handle("ask", (_event, question: string) => ask(question));
  ipcMain.handle("login", async () => codex?.login());
  ipcMain.handle("refresh-state", () => pipe?.requestState());
  ipcMain.handle("minimize-window", () => windowRef?.minimize());
});
app.on("will-quit", () => { globalShortcut.unregisterAll(); pipe?.stop(); codex?.stop(); });
