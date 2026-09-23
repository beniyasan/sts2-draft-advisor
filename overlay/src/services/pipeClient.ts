import { createConnection, Socket } from "node:net";
import { EventEmitter } from "node:events";
import { GameState } from "../shared/protocol";

const PIPE_PATH = process.platform === "win32" ? "\\\\.\\pipe\\DraftAdvisor.v1" : "/tmp/DraftAdvisor.v1";

/** Maintains the newline-delimited connection to the game mod. */
export class PipeClient extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = "";
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private reconnecting = false;
  private loggedFailure = false;

  constructor(private readonly connectSocket: () => Socket = () => createConnection(PIPE_PATH)) {
    super();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.reconnecting = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.buffer = "";
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
  }

  requestState(): void {
    this.send({ type: "request_state" });
  }

  private connect(): void {
    if (this.stopped) return;
    this.buffer = "";
    const socket = this.connectSocket();
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", chunk => { if (this.socket === socket) this.read(String(chunk)); });
    socket.on("connect", () => {
      if (this.socket !== socket) return;
      this.reconnecting = false;
      this.loggedFailure = false;
      this.emit("log", "pipe connected");
      this.emit("connection", true);
      this.requestState();
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (this.socket !== socket) return;
      if (!this.loggedFailure) {
        this.loggedFailure = true;
        this.emit("log", `pipe connect failed: ${error.code ?? error.message} (retrying every 1s)`);
      }
      this.reconnect();
    });
    socket.on("close", () => { if (this.socket === socket) this.reconnect(); });
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf("\n");
    while (end >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line) this.handleLine(line);
      end = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    try {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) return;
      if (value.type === "game_state") {
        this.emit("state", value as unknown as GameState);
      } else if (value.type === "toggle_window") {
        this.emit("toggle");
      }
    } catch {
      this.emit("log", `invalid pipe message ignored: ${line.slice(0, 120)}`);
    }
  }

  private send(message: object): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(`${JSON.stringify(message)}\n`);
  }

  private reconnect(): void {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    this.emit("connection", false);
    this.buffer = "";
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnecting = false;
      this.connect();
    }, 1000);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
