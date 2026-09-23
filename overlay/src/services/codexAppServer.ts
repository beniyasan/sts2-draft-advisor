import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; }
export interface CodexHooks { onDelta(delta: string): void; onCompleted(): void; onStatus(status: Record<string, unknown>): void; onAuthUrl(url: string): void; }

interface ModelEntry {
  id?: string; model?: string; isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
}

// Fastest efforts first — the overlay wants quick chat answers.
const FAST_EFFORTS = ["none", "minimal", "low"];

function pickEffort(model: ModelEntry | undefined): string | null {
  const supported = (model?.supportedReasoningEfforts ?? [])
    .map(option => option.reasoningEffort)
    .filter((effort): effort is string => !!effort);
  return FAST_EFFORTS.find(effort => supported.includes(effort)) ?? null;
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1; private pending = new Map<number, Pending>(); private buffer = "";
  private threadId: string | null = null; private model: string | null = null;
  private effort: string | null = null; private busy = false; private sawDelta = false;
  private completion: { resolve: () => void; reject: (error: Error) => void } | null = null;
  constructor(private readonly hooks: CodexHooks) {}

  async ask(prompt: string): Promise<void> {
    await this.ensureReady(); if (this.busy) throw new Error("前の相談がまだ処理中です。"); this.busy = true;
    this.sawDelta = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.completion = null;
          reject(new Error("Codex の回答がタイムアウトしました。"));
        }, 180000);
        this.completion = {
          resolve: () => { clearTimeout(timer); resolve(); },
          reject: (error: Error) => { clearTimeout(timer); reject(error); },
        };
        this.request("turn/start", { threadId: this.threadId, input: [{ type: "text", text: prompt, text_elements: [] }], model: this.model, effort: this.effort, summary: "concise" })
          .catch((error: unknown) => {
            this.completion = null;
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    } finally { this.busy = false; this.completion = null; }
  }
  async login(): Promise<void> {
    await this.ensureProcess();
    const result = await this.request("account/login/start", { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "codex" });
    if (result?.authUrl) this.hooks.onAuthUrl(result.authUrl);
  }
  stop(): void { this.process?.kill(); this.process = null; }

  private async ensureReady(): Promise<void> {
    await this.ensureProcess();
    if (!this.model) {
      const result = await this.request("model/list", { limit: 100, includeHidden: false });
      const models = (result?.data ?? []) as ModelEntry[];
      const ids = models.map(item => item.id ?? item.model).filter((id): id is string => !!id);
      const chosen = models.find(item => (item.id ?? item.model) === "gpt-6-luna")
        ?? models.find(item => item.isDefault)
        ?? models[0];
      this.model = chosen ? (chosen.id ?? chosen.model ?? null) : null;
      this.effort = pickEffort(chosen);
      this.hooks.onStatus({ model: this.model, modelOptions: ids });
      if (!this.model) throw new Error("利用可能なCodexモデルが見つかりません。");
    }
    if (!this.threadId) {
      const result = await this.request("thread/start", { model: this.model, serviceName: "sts2_draft_advisor" });
      this.threadId = result?.thread?.id ?? null;
      if (!this.threadId) throw new Error("Codex会話スレッドを作成できませんでした。");
    }
  }
  private async ensureProcess(): Promise<void> {
    if (this.process && !this.process.killed) return;
    // Wait for the "spawn" event before sending initialize — otherwise a failed
    // first spawn (ENOENT on Windows .cmd shims) would swallow the request.
    await this.spawnServer(process.env.CODEX_BIN ?? "codex", false);
    await this.request("initialize", { clientInfo: { name: "sts2_draft_advisor", title: "STS2 Draft Advisor", version: "0.1.0" } });
    this.send({ method: "initialized", params: {} });
  }
  private spawnServer(command: string, useShell: boolean): Promise<void> {
    const child = spawn(command, ["app-server"], { stdio: ["pipe", "pipe", "pipe"], shell: useShell });
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => this.read(chunk));
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => this.hooks.onStatus({ log: chunk.trim() }));
    return new Promise((resolve, reject) => {
      child.once("error", (error: NodeJS.ErrnoException) => {
        // npm-installed CLIs on Windows are .cmd shims that need a shell to spawn.
        if (!useShell && process.platform === "win32" && !process.env.CODEX_BIN) {
          this.spawnServer(command, true).then(resolve, reject);
          return;
        }
        reject(new Error(`codex の起動に失敗しました: ${error.message}`));
      });
      child.once("spawn", () => {
        this.process = child;
        // Runtime errors after a successful spawn.
        child.on("error", (error: Error) => {
          if (this.process === child) this.process = null;
          this.failAll(new Error(`codex の起動に失敗しました: ${error.message}`));
        });
        child.on("exit", () => {
          if (this.process !== child) return;
          this.process = null; this.threadId = null; this.model = null; this.effort = null;
          this.failAll(new Error("Codex App Serverが終了しました。"));
        });
        resolve();
      });
    });
  }
  private failAll(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    this.completion?.reject(error);
    this.completion = null;
  }
  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.hooks.onStatus({ log: `→ ${method}` });
      try { this.send({ method, id, params }); }
      catch (error) { this.pending.delete(id); reject(error); return; }
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Codex が応答しません (${method})`));
      }, 60000);
    });
  }
  private send(value: object): void { if (!this.process?.stdin.writable) throw new Error("Codex App Serverへ接続できません。"); this.process.stdin.write(`${JSON.stringify(value)}\n`); }
  private read(chunk: string): void {
    this.buffer += chunk; let end = this.buffer.indexOf("\n");
    while (end >= 0) { const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1); if (line) { try { this.handle(JSON.parse(line)); } catch (error) { this.hooks.onStatus({ error: String(error) }); } } end = this.buffer.indexOf("\n"); }
  }
  private handle(message: any): void {
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const waiter = this.pending.get(message.id)!; this.pending.delete(message.id);
      this.hooks.onStatus({ log: `← #${message.id} ${message.error ? "error" : "ok"}` });
      if (message.error) waiter.reject(new Error(message.error.message ?? "Codexエラー")); else waiter.resolve(message.result); return;
    }
    const method = message.method as string | undefined;
    if (method === "item/agentMessage/delta") {
      const delta = message.params?.delta ?? message.params?.text ?? "";
      if (delta) { if (!this.sawDelta) { this.sawDelta = true; this.hooks.onStatus({ log: "← delta stream started" }); } this.hooks.onDelta(delta); }
    }
    else if (method === "turn/completed") {
      this.hooks.onStatus({ log: `← turn/completed (${message.params?.turn?.status ?? "?"})` });
      const turn = message.params?.turn;
      if (turn?.status && turn.status !== "completed") this.completion?.reject(new Error(turn.error?.message ?? `相談が${turn.status}状態で終了しました。`));
      else this.completion?.resolve();
      this.completion = null;
      this.hooks.onCompleted();
    }
    else if (method === "error") this.hooks.onStatus({ error: message.params?.error?.message ?? "Codexエラー" });
    else if (method === "account/updated") this.hooks.onStatus({ authMode: message.params?.authMode, planType: message.params?.planType });
    else if (method) this.hooks.onStatus({ log: `← ${method}` });
  }
}
