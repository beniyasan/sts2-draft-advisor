import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

export interface CodexTransportHooks {
  onMessage(message: RpcMessage): void;
  onLog(message: string): void;
  onExit(error: Error): void;
}

/** Owns the Codex child process and newline-delimited JSON-RPC transport. */
export class CodexTransport {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = "";
  private pending = new Map<number, PendingRequest>();
  private starting: Promise<void> | null = null;
  private rejectStart: ((error: Error) => void) | null = null;

  constructor(
    private readonly hooks: CodexTransportHooks,
    private readonly spawnChild = (command: string, useShell: boolean): ChildProcessWithoutNullStreams =>
      spawn(command, ["app-server"], { stdio: ["pipe", "pipe", "pipe"], shell: useShell }),
  ) {}

  get running(): boolean {
    return this.process !== null && !this.process.killed;
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.running) return;
    const starting = this.spawnServer(process.env.CODEX_BIN ?? "codex", false);
    this.starting = starting;
    try {
      await starting;
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  stop(): void {
    this.close(new Error("Codex App Serverが停止しました。"));
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Codex が応答しません (${method})`));
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.hooks.onLog(`→ ${method}`);
      try {
        this.send({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(message: object): void {
    this.send(message);
  }

  private spawnServer(command: string, useShell: boolean): Promise<void> {
    const child = this.spawnChild(command, useShell);
    this.process = child;
    this.buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (this.process === child) this.read(String(chunk));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      if (this.process === child) this.hooks.onLog(String(chunk).trim());
    });
    return new Promise((resolve, reject) => {
      this.rejectStart = reject;
      let spawned = false;
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (this.process !== child) return;
        // npm .cmd shims need a shell on Windows; only retry a failed spawn.
        if (!spawned && !useShell && process.platform === "win32" && !process.env.CODEX_BIN) {
          this.process = null;
          this.spawnServer(command, true).then(resolve, reject);
          return;
        }
        this.close(new Error(`codex の起動に失敗しました: ${error.message}`));
      });
      child.stdin.on("error", error => {
        if (this.process === child) this.close(error);
      });
      child.once("spawn", () => {
        if (this.process !== child) return;
        spawned = true;
        this.rejectStart = null;
        resolve();
      });
      child.once("exit", () => {
        if (this.process === child) this.close(new Error("Codex App Serverが終了しました。"));
      });
    });
  }

  private close(error: Error): void {
    const child = this.process;
    this.process = null;
    this.buffer = "";
    this.rejectStart?.(error);
    this.rejectStart = null;
    this.starting = null;
    this.failAll(error);
    child?.kill();
    this.hooks.onExit(error);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private send(value: object): void {
    if (!this.process?.stdin.writable) throw new Error("Codex App Serverへ接続できません。");
    this.process.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf("\n");
    while (end >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line) {
        try {
          this.handleMessage(JSON.parse(line) as RpcMessage);
        } catch (error) {
          this.hooks.onLog(`invalid Codex message ignored: ${String(error)}`);
        }
      }
      end = this.buffer.indexOf("\n");
    }
  }

  private handleMessage(message: RpcMessage): void {
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      this.hooks.onLog(`← #${message.id} ${message.error ? "error" : "ok"}`);
      if (message.error) pending.reject(new Error(message.error.message ?? "Codexエラー"));
      else pending.resolve(message.result);
      return;
    }
    this.hooks.onMessage(message);
  }
}
