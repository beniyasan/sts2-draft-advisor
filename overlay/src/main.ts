import { app, globalShortcut, ipcMain, net, protocol, shell } from "electron";
import { createWriteStream } from "node:fs";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CodexAppServerClient } from "./services/codexAppServer";
import { CodexContextService } from "./services/codexContext";
import { PipeClient } from "./services/pipeClient";
import { OverlayWindow } from "./main/overlayWindow";
import { GameState } from "./shared/protocol";

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

const overlay = new OverlayWindow(__dirname, log);
let pipe: PipeClient | null = null;
let codex: CodexAppServerClient | null = null;
let context: CodexContextService | null = null;
let latestState: GameState | null = null;

function setupServices(): void {
  pipe = new PipeClient();
  pipe.on("state", (state: GameState) => {
    log(`game_state: ${state.screen?.kind ?? "?"}`);
    latestState = state;
    overlay.send("game-state", state);
    overlay.send("connection-status", { connected: true });
  });
  pipe.on("connection", (connected: boolean) => overlay.send("connection-status", { connected }));
  pipe.on("toggle", () => overlay.toggle());
  pipe.on("log", (message: string) => log(message));
  pipe.start();
  context = new CodexContextService();
  codex = new CodexAppServerClient({
    onDelta: delta => overlay.send("chat-delta", delta),
    onCompleted: () => overlay.send("chat-done"),
    onStatus: status => {
      if (status.log || status.error) log(`codex: ${status.log ?? status.error}`);
      overlay.send("codex-status", status);
    },
    onAuthUrl: url => void shell.openExternal(url),
  });
}
async function ask(question: string): Promise<void> {
  if (!codex || !context || !latestState) throw new Error("ゲーム状態がまだ取得できません。");
  await codex.ask(await context.buildPrompt(question, latestState));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => overlay.show());
  app.whenReady().then(() => {
    protocol.handle("live2d", request => {
      // live2d://model/<path under assets/live2d>
      const rel = normalize(decodeURIComponent(new URL(request.url).pathname).replace(/^[/\\]+/, ""));
      const file = join(assetsRoot, rel);
      if (!file.startsWith(assetsRoot + sep)) return new Response(null, { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    overlay.create();
    setupServices();
    const shortcutRegistered = globalShortcut.register("CommandOrControl+Shift+D", () => overlay.toggle());
    log(shortcutRegistered
      ? "Overlay shortcut registered: Ctrl+Shift+D"
      : "Overlay shortcut could not be registered. The in-game toggle (via pipe) still works.");
    ipcMain.handle("ask", (_event, question: string) => ask(question));
    ipcMain.handle("login", async () => codex?.login());
    ipcMain.handle("refresh-state", () => pipe?.requestState());
    ipcMain.handle("minimize-window", () => overlay.minimize());
  });
}
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  pipe?.stop();
  codex?.stop();
  logStream.end();
});
