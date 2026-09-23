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
  private effort: string | null = null; private busy = false;
  private completion: { resolve: () => void; reject: (error: Error) => void } | null = null;
  constructor(private readonly hooks: CodexHooks) {}

  async ask(prompt: string): Promise<void> {
    await this.ensureReady(); if (this.busy) throw new Error("前の相談がまだ処理中です。"); this.busy = true;
    try {
      await new Promise<void>(async (resolve, reject) => {
        this.completion = { resolve, reject };
        try {
          await this.request("turn/start", { threadId: this.threadId, input: [{ type: "text", text: prompt, text_elements: [] }], model: this.model, effort: this.effort, summary: "concise" });
        } catch (error) {
          this.completion = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
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
    const command = process.env.CODEX_BIN ?? "codex";
    this.process = spawn(command, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    this.process.stdout.setEncoding("utf8"); this.process.stdout.on("data", (chunk: string) => this.read(chunk));
    this.process.stderr.on("data", (chunk: string) => this.hooks.onStatus({ log: chunk.trim() }));
    // Without an "error" listener a missing codex binary would crash the app.
    this.process.on("error", (error: Error) => this.failAll(new Error(`codex の起動に失敗しました: ${error.message}`)));
    this.process.on("exit", () => {
      this.process = null; this.threadId = null; this.model = null; this.effort = null;
      this.failAll(new Error("Codex App Serverが終了しました。"));
    });
    await this.request("initialize", { clientInfo: { name: "sts2_draft_advisor", title: "STS2 Draft Advisor", version: "0.1.0" } });
    this.send({ method: "initialized", params: {} });
  }
  private failAll(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    this.completion?.reject(error);
    this.completion = null;
  }
  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.send({ method, id, params }); });
  }
  private send(value: object): void { if (!this.process?.stdin.writable) throw new Error("Codex App Serverへ接続できません。"); this.process.stdin.write(`${JSON.stringify(value)}\n`); }
  private read(chunk: string): void {
    this.buffer += chunk; let end = this.buffer.indexOf("\n");
    while (end >= 0) { const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1); if (line) { try { this.handle(JSON.parse(line)); } catch (error) { this.hooks.onStatus({ error: String(error) }); } } end = this.buffer.indexOf("\n"); }
  }
  private handle(message: any): void {
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const waiter = this.pending.get(message.id)!; this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "Codexエラー")); else waiter.resolve(message.result); return;
    }
    const method = message.method as string | undefined;
    if (method === "item/agentMessage/delta") { const delta = message.params?.delta ?? message.params?.text ?? ""; if (delta) this.hooks.onDelta(delta); }
    else if (method === "turn/completed") {
      const turn = message.params?.turn;
      if (turn?.status && turn.status !== "completed") this.completion?.reject(new Error(turn.error?.message ?? `相談が${turn.status}状態で終了しました。`));
      else this.completion?.resolve();
      this.completion = null;
      this.hooks.onCompleted();
    }
    else if (method === "error") this.hooks.onStatus({ error: message.params?.error?.message ?? "Codexエラー" });
    else if (method === "account/updated") this.hooks.onStatus({ authMode: message.params?.authMode, planType: message.params?.planType });
  }
}
