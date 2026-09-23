import { BrowserWindow } from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

export class OverlayWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly bundleRoot: string, private readonly log: (message: string) => void) {}

  create(): void {
    const transparent = !process.env.OVERLAY_OPAQUE;
    const window = new BrowserWindow({
      width: 520, height: 720, minWidth: 360, minHeight: 420,
      frame: false, transparent, alwaysOnTop: true, resizable: true,
      skipTaskbar: false, show: false,
      backgroundColor: transparent ? "#00000000" : "#17120f",
      webPreferences: {
        preload: join(this.bundleRoot, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.window = window;
    window.once("ready-to-show", () => window.show());
    void window.loadFile(join(this.bundleRoot, "renderer", "index.html"))
      .catch(error => this.log(`Overlay UI failed to load: ${error}`));
    window.webContents.on("did-fail-load", (_event, code, description) => this.log(`load failed: ${code} ${description}`));
    window.webContents.on("console-message", (_event, _level, message) => this.log(`renderer: ${message}`));

    let shotTimer: ReturnType<typeof setTimeout> | undefined;
    const shotDir = process.env.OVERLAY_SHOT_DIR;
    if (shotDir) window.webContents.once("did-finish-load", () => {
      shotTimer = setTimeout(() => void this.capture(window, shotDir), 4000);
    });
    window.on("closed", () => {
      clearTimeout(shotTimer);
      if (this.window === window) this.window = null;
    });
  }

  send(channel: string, value?: unknown): void {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, value);
  }

  toggle(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    else if (window.isVisible()) window.minimize();
    else window.show();
    window.focus();
  }

  show(): void {
    this.window?.show();
    this.window?.focus();
  }

  minimize(): void {
    this.window?.minimize();
  }

  private async capture(window: BrowserWindow, directory: string): Promise<void> {
    if (window.isDestroyed()) return;
    try {
      const image = await window.webContents.capturePage();
      await writeFile(join(directory, "overlay-shot.png"), image.toPNG());
      this.log(`shot saved: ${directory}`);
    } catch (error) {
      this.log(`shot failed: ${error}`);
    }
  }
}
