export type AvatarState = "idle" | "thinking" | "speaking" | "error";

/**
 * Loads the bundled Cubism model (zundamon sample data) when both
 * `vendor/live2dcubismcore.min.js` and `assets/live2d/` are present; otherwise
 * stays a plain placeholder badge. The engine module throws at import time
 * when the core is missing, so it is loaded lazily inside try/catch.
 */
export class Live2DAdapter {
  private model: any = null;
  private app: any = null;
  private ticker: any = null;
  private resizeObserver: ResizeObserver | null = null;
  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private speakUntil = 0;
  private state: AvatarState = "idle";
  private renderedState: AvatarState | null = null;
  private destroyed = false;

  constructor(private readonly element: HTMLElement) {
    this.setState("idle");
    void this.init();
  }

  setState(state: AvatarState): void {
    if (this.destroyed || this.renderedState === state) return;
    this.state = state;
    this.renderedState = state;
    if (state !== "speaking") this.speakUntil = 0;
    if (this.model) {
      this.applyState(state);
      return;
    }
    this.element.dataset.state = state;
    this.element.textContent = state === "thinking" ? "考え中…" : state === "speaking" ? "分析中" : "Draft Advisor";
  }

  /** Called on each streamed answer chunk — keeps the mouth moving while speaking. */
  pulseSpeaking(): void {
    if (this.destroyed) return;
    this.speakUntil = performance.now() + 600;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.release();
  }

  private release(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.fitTimer = null;
    if (this.ticker && this.app) this.app.ticker.remove(this.ticker);
    this.ticker = null;
    const app = this.app;
    this.app = null;
    this.model = null;
    if (app) this.destroyApplication(app);
  }

  private async init(): Promise<void> {
    let pendingApp: any = null;
    let pendingModel: any = null;
    try {
      if (!(window as any).Live2DCubismCore) return;
      const manifest = await fetch("live2d://model/manifest.json").then(r => (r.ok ? r.json() : null));
      if (this.destroyed || !manifest?.model) return;

      const [pixi, engine] = await Promise.all([
        import("pixi.js"),
        import("untitled-pixi-live2d-engine/cubism").catch(() => null),
      ]);
      if (this.destroyed || !engine) return;

      pixi.extensions.add(engine.Live2DPlugin);
      const app = new pixi.Application();
      pendingApp = app;
      await app.init({
        resizeTo: this.element,
        backgroundAlpha: 0,
        preference: "webgl",
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      if (this.destroyed) return;
      const model = await engine.Live2DModel.from(`live2d://model/${manifest.model}`);
      pendingModel = model;
      if (this.destroyed) return;
      app.stage.addChild(model);
      this.model = model;
      this.app = app;
      pendingModel = null;
      pendingApp = null;
      this.element.replaceChildren(app.canvas);
      this.element.classList.add("live2d");
      app.resize();
      this.fit();
      // Drawable bounds resolve after the first draw; refit once they arrive.
      this.fitTimer = setTimeout(() => { this.fitTimer = null; this.fit(); }, 500);
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.element);
      // Mouth follows streamed text instead of audio.
      this.ticker = (ticker: any) => this.tick(ticker);
      app.ticker.add(this.ticker);
      this.applyState(this.state);
      console.log(`Live2D model loaded: ${manifest.model}`);
    } catch (error) {
      this.release();
      if (!this.destroyed) {
        this.element.classList.remove("live2d");
        this.renderedState = null;
        this.setState(this.state);
        console.warn("Live2D unavailable, keeping placeholder avatar:", error);
      }
    } finally {
      pendingModel?.destroy();
      if (pendingApp) this.destroyApplication(pendingApp);
    }
  }

  private destroyApplication(app: any): void {
    // Initialization may have failed before Pixi created its renderer.
    try { app.destroy(true, { children: true }); }
    catch (error) { console.warn("Live2D cleanup failed:", error); }
  }

  private fit(): void {
    if (!this.model || !this.app) return;
    const w = this.element.clientWidth, h = this.element.clientHeight;
    if (!w || !h) return;
    // The element grows from its 125px placeholder size once the live2d class is
    // applied; Pixi's resizeTo observer can lag, so reconcile explicitly.
    if (this.app.screen.width !== w || this.app.screen.height !== h) this.app.resize();
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const bounds = this.model.bounds;
    const bw = bounds?.width || this.model.width, bh = bounds?.height || this.model.height;
    if (!bw || !bh) return;
    const scale = Math.min(sw / bw, sh / bh) * 0.92;
    this.model.scale.set(scale);
    this.model.position.set(0, 0);
    const gb = this.model.getBounds();
    this.model.position.set(sw / 2 - (gb.x + gb.width / 2), sh - (gb.y + gb.height));
  }

  private tick(ticker: any): void {
    if (!this.model) return;
    const speaking = performance.now() < this.speakUntil;
    try {
      const open = speaking ? 0.35 + 0.65 * Math.abs(Math.sin(performance.now() / 90)) : 0;
      this.model.internalModel?.coreModel?.setParameterValueById?.("ParamMouthOpenY", open);
    } catch { /* parameter unavailable — ignore */ }
    void ticker;
  }

  private applyState(state: AvatarState): void {
    const play = (name: string, loop = false) => {
      const i = this.motionIndex(name);
      if (i >= 0) void this.model.motion("", i, undefined, { loop });
    };
    const expr = (name: string) => { try { void this.model.expression(name); } catch { } };
    try { this.model.internalModel?.motionManager?.stopAllMotions?.(); } catch { }
    if (state === "thinking") {
      const thinks = ["mtnBody_think", "mtnBody_think2", "mtnBody_think3"];
      play(thinks[Math.floor(Math.random() * thinks.length)]);
    }
    else if (state === "speaking") play("mtnFace_talk", true);
    else if (state === "error") { expr("exp_sad"); play("mtnBody_tremble"); }
    else { expr("exp_smile"); play("mtnBody_yes"); }
  }

  private motionIndex(name: string): number {
    const groups = this.model?.internalModel?.settings?.motions ?? {};
    const list = groups[""] ?? Object.values(groups)[0] ?? [];
    return list.findIndex((m: any) => String(m?.File ?? m?.file ?? "").includes(name));
  }
}
