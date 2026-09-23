import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource } from "./load-source.mjs";

const { ChatState, ChatView, ChatController, PromptPresetStore, renderMarkdown } = await loadSource([
  "./src/renderer/chatState.ts", "./src/renderer/chatView.ts", "./src/renderer/chatController.ts", "./src/renderer/promptPresets.ts",
]);
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element extends EventTarget {
  children = [];
  value = "";
  className = "";
  dataset = {};
  classes = new Set();
  classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
  ownerDocument = { createElement: () => new Element() };
  text = "";
  writes = 0;
  scrollTop = 0;
  scrollHeight = 100;
  get textContent() { return this.text; }
  set textContent(value) { this.text = value; this.writes++; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
}
function elements() {
  return Object.fromEntries(["messages", "input", "context", "status", "model", "form", "clear", "presetSelect", "presetUse", "presetName", "presetSave", "presetDelete", "refresh", "login", "close"]
    .map(name => [name, new Element()]));
}

test("chat state handles begin, streaming, completion and failure", () => {
  const state = new ChatState();
  assert.equal(state.begin("  "), false);
  assert.equal(state.begin(" question "), true);
  assert.equal(state.avatarState, "thinking");
  assert.equal(state.begin("duplicate"), false);
  state.appendDelta("hello");
  state.appendDelta(" world");
  assert.equal(state.avatarState, "speaking");
  assert.equal(state.messages[1].text, "hello world");
  state.finish();
  assert.equal(state.avatarState, "idle");
  assert.equal(state.appendDelta("late"), false);
  state.begin("next");
  state.fail(new Error("failed"));
  assert.equal(state.busy, false);
  assert.deepEqual(state.messages.at(-1), { role: "system", text: "failed" });
  state.applyStatus({ error: "network", log: "diagnostic" });
  assert.equal(state.avatarState, "error");
  assert.equal("log" in state, false);
  state.begin("retry");
  assert.equal(state.error, null);
});

test("markdown responses render common blocks and escape raw HTML", () => {
  const html = renderMarkdown("## 結論\n\n- **瀉血**を検討\n- `0`コスト\n\n```js\nalert(1)\n```\n\n<script>bad()</script>");
  assert.match(html, /<h2>結論<\/h2>/);
  assert.match(html, /<ul><li><strong>瀉血<\/strong>を検討<\/li>/);
  assert.match(html, /<pre class="md-code"><code class="language-js">alert\(1\)<\/code><\/pre>/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("clear removes messages and suppresses the late response", () => {
  const state = new ChatState();
  state.begin("question");
  state.appendDelta("partial");
  state.clear();
  assert.deepEqual(state.messages, []);
  assert.equal(state.appendDelta("late"), false);
  state.finish();
  assert.equal(state.busy, false);
});

test("custom prompt presets persist and built-ins cannot be deleted", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = new PromptPresetStore(storage);
  const saved = first.save("低コスト確認", "低コストカードを優先して比較して。");
  assert.ok(saved);
  assert.equal(first.list().at(-1).text, "低コストカードを優先して比較して。");
  const second = new PromptPresetStore(storage);
  assert.equal(second.list().at(-1).name, "低コスト確認");
  assert.equal(second.remove("deck-pick"), false);
  assert.equal(second.remove(saved.id), true);
});

test("view reuses message nodes and leaves text and scroll position intact on status updates", () => {
  const dom = elements(), state = new ChatState(), view = new ChatView(dom);
  state.begin("question");
  view.render(state);
  const user = dom.messages.children[0];
  state.appendDelta("first");
  view.render(state);
  const assistant = dom.messages.children[1];
  state.appendDelta(" second");
  view.render(state);
  assert.equal(dom.messages.children[0], user);
  assert.equal(dom.messages.children[1], assistant);
  assert.equal(user.writes, 1);
  assert.equal(assistant.textContent, "first second");
  assert.equal(assistant.writes, 2);
  dom.messages.scrollTop = 10;
  state.applyStatus({ connected: true });
  view.render(state);
  assert.equal(assistant.writes, 2);
  assert.equal(dom.messages.scrollTop, 10);
});

test("controller handles IPC, failed asks, unsubscribe and DOM listener removal", async () => {
  const dom = elements(), listeners = {}, questions = [], avatarStates = [];
  let rejectAsk, destroyed = 0;
  const subscribe = name => listener => {
    listeners[name] = listener;
    return () => delete listeners[name];
  };
  const api = {
    onState: subscribe("state"), onDelta: subscribe("delta"),
    onChatDone: subscribe("done"), onStatus: subscribe("status"),
    ask: question => { questions.push(question); return new Promise((_resolve, reject) => { rejectAsk = reject; }); },
    login: async () => {}, refreshState: async () => {}, minimize: async () => {},
  };
  const controller = new ChatController(api, new ChatView(dom), {
    setState: state => avatarStates.push(state), pulseSpeaking() {}, destroy: () => destroyed++,
  });
  dom.input.value = "question";
  dom.form.dispatchEvent(new Event("submit", { cancelable: true }));
  assert.deepEqual(questions, ["question"]);
  listeners.delta("answer");
  assert.equal(avatarStates.at(-1), "speaking");
  rejectAsk(new Error("failed ask"));
  await flush();
  assert.equal(avatarStates.at(-1), "idle");
  assert.equal(dom.messages.children.at(-1).textContent, "failed ask");
  dom.clear.dispatchEvent(new Event("click"));
  assert.equal(dom.messages.children.length, 0);
  controller.destroy();
  controller.destroy();
  assert.equal(destroyed, 1);
  assert.deepEqual(listeners, {});
  dom.input.value = "ignored";
  dom.form.dispatchEvent(new Event("submit"));
  assert.equal(questions.length, 1);
});

const { Live2DAdapter } = await loadSource(["./src/renderer/live2d.ts"], [{
  name: "fake-live2d-engine",
  setup(build) {
    build.onResolve({ filter: /^(pixi\.js|untitled-pixi-live2d-engine\/cubism)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "pixi.js"
      ? `export class Application { constructor() { return globalThis.avatarFixture.app; } } export const extensions = { add() {} };`
      : `export const Live2DPlugin = {}; export const Live2DModel = { from: () => globalThis.avatarFixture.loadModel() };`,
    }));
  },
}]);

function avatarFixture(t) {
  let appDestroyed = 0, modelDestroyed = 0, disconnected = 0, removed = 0, stopped = 0;
  const motions = [], expressions = [];
  const model = {
    destroy() { modelDestroyed++; },
    internalModel: {
      settings: { motions: { "": [{ File: "mtnBody_yes" }, { File: "mtnFace_talk" }, { File: "mtnBody_think" }] } },
      motionManager: { stopAllMotions() { stopped++; } },
    },
    motion(...args) { motions.push(args); }, expression(name) { expressions.push(name); },
  };
  const app = {
    init: async () => {}, canvas: new Element(), resize() {},
    stage: { children: [], addChild(model) { this.children.push(model); } },
    ticker: { add() {}, remove() { removed++; } },
    destroy() { appDestroyed++; this.stage.children.forEach(model => model.destroy()); },
  };
  const fixture = { app, loadModel: async () => model };
  for (const [key, value] of Object.entries({
    avatarFixture: fixture,
    window: { Live2DCubismCore: {}, devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} disconnect() { disconnected++; } },
    fetch: async () => ({ ok: true, json: async () => ({ model: "test.model3.json" }) }),
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  const element = new Element();
  element.clientWidth = 0;
  element.clientHeight = 0;
  const adapter = new Live2DAdapter(element);
  t.after(() => adapter.destroy());
  return { adapter, fixture, model, app, element, motions, expressions,
    get counts() { return { appDestroyed, modelDestroyed, disconnected, removed, stopped }; },
  };
}

test("avatar changes motion only when state changes and releases resources once", async t => {
  const f = avatarFixture(t);
  await flush();
  const initialStops = f.counts.stopped;
  f.adapter.setState("speaking");
  f.adapter.setState("speaking");
  f.adapter.pulseSpeaking();
  assert.equal(f.counts.stopped, initialStops + 1);
  assert.equal(f.motions.at(-1)[1], 1);
  f.adapter.destroy();
  f.adapter.destroy();
  assert.deepEqual(f.counts, { appDestroyed: 1, modelDestroyed: 1, disconnected: 1, removed: 1, stopped: initialStops + 1 });
});

test("avatar destroyed while model loads releases the late model and app without attaching DOM", async t => {
  const f = avatarFixture(t);
  let resolveModel;
  f.fixture.loadModel = () => new Promise(resolve => { resolveModel = resolve; });
  await flush();
  f.adapter.destroy();
  resolveModel(f.model);
  await flush();
  assert.equal(f.counts.appDestroyed, 1);
  assert.equal(f.counts.modelDestroyed, 1);
  assert.equal(f.element.children.length, 0);
  assert.equal(f.element.classes.has("live2d"), false);
});

test("avatar model load failure releases the app and preserves the placeholder", async t => {
  const f = avatarFixture(t);
  t.mock.method(console, "warn", () => {});
  f.fixture.loadModel = async () => { throw new Error("load failed"); };
  await flush();
  assert.equal(f.counts.appDestroyed, 1);
  assert.equal(f.element.textContent, "Draft Advisor");
  assert.equal(f.element.classes.has("live2d"), false);
});
