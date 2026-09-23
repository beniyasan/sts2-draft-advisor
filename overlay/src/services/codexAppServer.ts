import { CodexTransport, CodexTransportHooks, RpcMessage } from "./codexTransport";

interface ModelEntry {
  id?: string;
  model?: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>;
}

export interface CodexHooks {
  onDelta(delta: string): void;
  onCompleted(): void;
  onStatus(status: Record<string, unknown>): void;
  onAuthUrl(url: string): void;
}

const FAST_EFFORTS = ["none", "minimal", "low"];

function pickEffort(model: ModelEntry | undefined): string | null {
  const supported = (model?.supportedReasoningEfforts ?? [])
    .map(option => option.reasoningEffort)
    .filter((effort): effort is string => !!effort);
  return FAST_EFFORTS.find(effort => supported.includes(effort)) ?? null;
}

/** Coordinates Codex conversations on top of the independent JSON-RPC transport. */
export class CodexAppServerClient {
  private readonly transport: CodexTransport;
  private threadId: string | null = null;
  private model: string | null = null;
  private effort: string | null = null;
  private busy = false;
  private sawDelta = false;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private generation = 0;
  private completion: { resolve: () => void; reject: (error: Error) => void } | null = null;

  constructor(
    private readonly hooks: CodexHooks,
    createTransport: (hooks: CodexTransportHooks) => CodexTransport = hooks => new CodexTransport(hooks),
  ) {
    this.transport = createTransport({
      onMessage: message => this.handle(message),
      onLog: log => this.hooks.onStatus({ log }),
      onExit: error => this.handleTransportExit(error),
    });
  }

  async ask(prompt: string): Promise<void> {
    if (this.busy) throw new Error("前の相談がまだ処理中です。");
    this.busy = true;
    const generation = this.generation;
    this.sawDelta = false;
    try {
      await this.ensureReady();
      if (generation !== this.generation) throw new Error("Codex App Serverが停止しました。");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          completion.reject(new Error("Codex の回答がタイムアウトしました。"));
          // Discard the old stream so late notifications cannot enter the next answer.
          this.transport.stop();
        }, 180000);
        const completion = {
          resolve: () => { clearTimeout(timer); resolve(); },
          reject: (error: Error) => { clearTimeout(timer); reject(error); },
        };
        this.completion = completion;
        this.transport.request("turn/start", {
          threadId: this.threadId,
          input: [{ type: "text", text: prompt, text_elements: [] }],
          model: this.model,
          effort: this.effort,
          summary: "concise",
        }).catch(error => {
          if (this.completion !== completion) return;
          completion.reject(error instanceof Error ? error : new Error(String(error)));
          this.transport.stop();
        });
      });
    } finally {
      this.busy = false;
      this.completion = null;
    }
  }

  async login(): Promise<void> {
    await this.ensureProcess();
    const result = await this.transport.request("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "codex",
    }) as { authUrl?: string } | undefined;
    if (result?.authUrl) this.hooks.onAuthUrl(result.authUrl);
  }

  stop(): void {
    this.transport.stop();
  }

  private async ensureReady(): Promise<void> {
    await this.ensureProcess();
    if (!this.model) {
      const result = await this.transport.request("model/list", { limit: 100, includeHidden: false }) as { data?: ModelEntry[] };
      const models = result?.data ?? [];
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
      const result = await this.transport.request("thread/start", { model: this.model, serviceName: "sts2_draft_advisor" }) as { thread?: { id?: string } };
      this.threadId = result?.thread?.id ?? null;
      if (!this.threadId) throw new Error("Codex会話スレッドを作成できませんでした。");
    }
  }

  private async ensureProcess(): Promise<void> {
    if (this.initializing) return this.initializing;
    if (this.initialized) return;
    const initializing = this.initialize();
    this.initializing = initializing;
    try {
      await initializing;
    } finally {
      if (this.initializing === initializing) this.initializing = null;
    }
  }

  private async initialize(): Promise<void> {
    const generation = this.generation;
    try {
      await this.transport.start();
      if (generation !== this.generation) throw new Error("Codex App Serverが停止しました。");
      await this.transport.request("initialize", {
        clientInfo: { name: "sts2_draft_advisor", title: "STS2 Draft Advisor", version: "0.1.0" },
      });
      this.transport.notify({ method: "initialized", params: {} });
      this.initialized = true;
    } catch (error) {
      if (generation === this.generation) this.transport.stop();
      throw error;
    }
  }

  private handle(message: RpcMessage): void {
    const method = message.method;
    if (method === "item/agentMessage/delta") {
      if (!this.completion) return;
      const params = asRecord(message.params);
      const delta = typeof params?.delta === "string" ? params.delta : typeof params?.text === "string" ? params.text : "";
      if (delta) {
        if (!this.sawDelta) {
          this.sawDelta = true;
          this.hooks.onStatus({ log: "← delta stream started" });
        }
        this.hooks.onDelta(delta);
      }
    } else if (method === "turn/completed") {
      if (!this.completion) return;
      const params = asRecord(message.params);
      const turn = asRecord(params?.turn);
      const turnStatus = typeof turn?.status === "string" ? turn.status : "?";
      this.hooks.onStatus({ log: `← turn/completed (${turnStatus})` });
      if (turn?.status && turnStatus !== "completed") {
        const error = asRecord(turn?.error);
        this.completion?.reject(new Error(typeof error?.message === "string" ? error.message : `相談が${turnStatus}状態で終了しました。`));
      } else {
        this.completion?.resolve();
      }
      this.completion = null;
      this.hooks.onCompleted();
    } else if (method === "error") {
      const params = asRecord(message.params);
      const error = asRecord(params?.error);
      this.hooks.onStatus({ error: typeof error?.message === "string" ? error.message : "Codexエラー" });
    } else if (method === "account/updated") {
      const params = asRecord(message.params);
      this.hooks.onStatus({ authMode: params?.authMode, planType: params?.planType });
    } else if (method) {
      this.hooks.onStatus({ log: `← ${method}` });
    }
  }

  private handleTransportExit(error: Error): void {
    this.generation++;
    this.initializing = null;
    this.resetSession();
    this.completion?.reject(error);
    this.completion = null;
  }

  private resetSession(): void {
    this.threadId = null;
    this.model = null;
    this.effort = null;
    this.initialized = false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
