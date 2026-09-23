import { OverlayApi } from "../shared/protocol";
import type { Live2DAdapter } from "./live2d";
import { ChatState, errorMessage } from "./chatState";
import { ChatView } from "./chatView";
import { PromptPresetStore } from "./promptPresets";

export class ChatController {
  private readonly state = new ChatState();
  private readonly events = new AbortController();
  private readonly unsubscribe: Array<() => void>;
  private readonly presets = new PromptPresetStore();
  private destroyed = false;

  constructor(
    private readonly api: OverlayApi,
    private readonly view: ChatView,
    private readonly avatar: Pick<Live2DAdapter, "setState" | "pulseSpeaking" | "destroy">,
  ) {
    this.unsubscribe = [
      api.onState(game => { this.state.setGame(game); this.render(); }),
      api.onDelta(delta => {
        if (!this.state.appendDelta(delta)) return;
        this.avatar.pulseSpeaking();
        this.render();
      }),
      api.onChatDone(() => { this.state.finish(); this.render(); }),
      api.onStatus(status => { this.state.applyStatus(status); this.render(); }),
    ];
    const options = { signal: this.events.signal };
    const { form, refresh, login, close, clear, presetSelect, presetUse, presetName, presetSave, presetDelete } = view.elements;
    view.renderPresets(this.presets.list());
    form.addEventListener("submit", event => {
      event.preventDefault();
      void this.submit();
    }, options);
    refresh.addEventListener("click", () => void this.perform(() => api.refreshState()), options);
    login.addEventListener("click", () => void this.perform(() => api.login()), options);
    close.addEventListener("click", () => void this.perform(() => api.minimize()), options);
    clear.addEventListener("click", () => {
      this.state.clear();
      this.view.elements.input.value = "";
      this.render();
    }, options);
    presetUse.addEventListener("click", () => {
      const preset = this.presets.list().find(item => item.id === presetSelect.value);
      if (!preset) return;
      view.elements.input.value = preset.text;
      view.elements.input.focus();
    }, options);
    presetSave.addEventListener("click", () => {
      const preset = this.presets.save(presetName.value, view.elements.input.value);
      if (!preset) return;
      presetName.value = "";
      view.renderPresets(this.presets.list(), preset.id);
    }, options);
    presetDelete.addEventListener("click", () => {
      if (this.presets.remove(presetSelect.value)) view.renderPresets(this.presets.list());
    }, options);
    this.render();
    void api.rendererReady();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.abort();
    this.unsubscribe.forEach(unsubscribe => unsubscribe());
    this.avatar.destroy();
  }

  private async submit(): Promise<void> {
    const question = this.view.elements.input.value.trim();
    if (!this.state.begin(question)) return;
    this.view.elements.input.value = "";
    this.render();
    try {
      await this.api.ask(question);
    } catch (error) {
      this.state.fail(error);
      this.render();
    }
  }

  private async perform(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.state.error = errorMessage(error);
      this.render();
    }
  }

  private render(): void {
    if (this.destroyed) return;
    this.view.render(this.state);
    this.avatar.setState(this.state.avatarState);
  }
}
