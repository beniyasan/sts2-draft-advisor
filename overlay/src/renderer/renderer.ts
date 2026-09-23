import { ChatController } from "./chatController";
import { ChatView } from "./chatView";
import { Live2DAdapter } from "./live2d";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing overlay element: ${id}`);
  return element as T;
}

const controller = new ChatController(window.draftAdvisor, new ChatView({
  messages: byId("messages"),
  input: byId<HTMLTextAreaElement>("input"),
  context: byId("context"),
  status: byId("status"),
  model: byId("model"),
  form: byId<HTMLFormElement>("form"),
  clear: byId("clear"),
  presetSelect: byId<HTMLSelectElement>("preset-select"),
  presetUse: byId("preset-use"),
  presetName: byId<HTMLInputElement>("preset-name"),
  presetSave: byId("preset-save"),
  presetDelete: byId("preset-delete"),
  refresh: byId("refresh"),
  login: byId("login"),
  close: byId("close"),
}), new Live2DAdapter(byId("avatar")));

window.addEventListener("beforeunload", () => controller.destroy(), { once: true });
