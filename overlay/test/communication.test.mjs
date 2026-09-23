import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { loadSource } from "./load-source.mjs";

const { PipeClient, CodexTransport, CodexAppServerClient } = await loadSource([
  "./src/services/pipeClient.ts", "./src/services/codexTransport.ts", "./src/services/codexAppServer.ts",
]);
const { GameStateRelay } = await loadSource(["./src/main/gameStateRelay.ts"]);
const flush = () => new Promise(resolve => setImmediate(resolve));

test("game state relay replays the latest state when the renderer becomes ready", () => {
  const sent = [], requests = [];
  const relay = new GameStateRelay((channel, value) => sent.push([channel, value]), () => requests.push(true));
  const state = { type: "game_state", runId: "run-1" };
  relay.publishState(state);
  relay.publishConnection(true);
  assert.deepEqual(sent, []);
  relay.markRendererReady();
  assert.deepEqual(sent, [["connection-status", { connected: true }], ["game-state", state]]);
  assert.deepEqual(requests, []);
});

test("game state relay requests a snapshot when it has no cached state", () => {
  const sent = [], requests = [];
  const relay = new GameStateRelay((channel, value) => sent.push([channel, value]), () => requests.push(true));
  relay.publishConnection(true);
  relay.markRendererReady();
  assert.deepEqual(sent, [["connection-status", { connected: true }]]);
  assert.equal(requests.length, 1);
  relay.publishState({ type: "game_state", runId: "run-2" });
  assert.equal(sent.at(-1)[0], "game-state");
  relay.publishConnection(false);
  assert.deepEqual(sent.at(-1), ["connection-status", { connected: false }]);
});

class FakeSocket extends EventEmitter {
  destroyed = false;
  writes = [];
  setEncoding() {}
  write(value) { this.writes.push(JSON.parse(value)); }
  destroy() { this.destroyed = true; this.emit("close"); }
}

class FakeChild extends EventEmitter {
  killed = false;
  requests = [];
  stdout = new PassThrough();
  stderr = new PassThrough();
  constructor(onRequest = () => {}) {
    super();
    this.stdin = new Writable({ write: (chunk, _encoding, done) => {
      const request = JSON.parse(String(chunk));
      this.requests.push(request);
      queueMicrotask(() => onRequest(request, this));
      done();
    } });
  }
  kill() { this.killed = true; this.emit("exit", 0); }
  reply(request, result = {}) { this.send({ id: request.id, result }); }
  send(message) { this.stdout.write(JSON.stringify(message) + "\n"); }
}

function transportFixture(t, onRequest) {
  const children = [], messages = [], exits = [], logs = [];
  const transport = new CodexTransport({
    onMessage: message => messages.push(message),
    onLog: message => logs.push(message),
    onExit: error => exits.push(error),
  }, () => {
    const child = new FakeChild(onRequest);
    children.push(child);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  t.after(() => transport.stop());
  return { transport, children, messages, exits, logs };
}

function clientFixture(t, onTurn = (request, child) => child.reply(request)) {
  const children = [], deltas = [], authUrls = [];
  let completed = 0;
  const client = new CodexAppServerClient({
    onDelta: delta => deltas.push(delta), onCompleted: () => completed++,
    onStatus() {}, onAuthUrl: url => authUrls.push(url),
  }, hooks => new CodexTransport(hooks, () => {
    const child = new FakeChild((request, child) => {
      if (request.id === undefined) return;
      switch (request.method) {
        case "model/list": child.reply(request, { data: [{ id: "test-model", isDefault: true }] }); break;
        case "thread/start": child.reply(request, { thread: { id: "test-thread" } }); break;
        case "account/login/start": child.reply(request, { authUrl: "https://example.test/login" }); break;
        case "turn/start": onTurn(request, child); break;
        default: child.reply(request);
      }
    });
    children.push(child);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }));
  t.after(() => client.stop());
  return { client, children, deltas, authUrls, get completed() { return completed; } };
}

function finish(child, status = "completed") {
  child.send({ method: "turn/completed", params: { turn: { status, error: { message: "turn failed" } } } });
}

test("pipe handles split lines, reconnect discards fragments and stale socket events", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sockets = [], states = [];
  let toggles = 0;
  const pipe = new PipeClient(() => { const socket = new FakeSocket(); sockets.push(socket); return socket; });
  t.after(() => pipe.stop());
  pipe.on("state", value => states.push(value));
  pipe.on("toggle", () => toggles++);
  pipe.start();
  pipe.start();
  assert.equal(sockets.length, 1);
  sockets[0].emit("connect");
  assert.deepEqual(sockets[0].writes, [{ type: "request_state" }]);
  sockets[0].emit("data", '{"type":"game_');
  sockets[0].emit("data", 'state","runId":"first"}\ninvalid\n{"type":"toggle_window"}\n{"type":');
  assert.equal(states[0].runId, "first");
  assert.equal(toggles, 1);
  sockets[0].emit("error", new Error("disconnect"));
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  sockets[0].emit("close");
  sockets[0].emit("data", '{"type":"toggle_window"}\n');
  sockets[1].emit("connect");
  sockets[1].emit("data", '{"type":"game_state","runId":"second"}\n');
  assert.equal(states[1].runId, "second");
  assert.equal(toggles, 1);
  sockets[1].emit("close");
  pipe.stop();
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  pipe.start();
  assert.equal(sockets.length, 3);
});

test("transport shares startup and resolves fragmented responses independently of notifications", async t => {
  const f = transportFixture(t);
  await Promise.all([f.transport.start(), f.transport.start()]);
  assert.equal(f.children.length, 1);
  const child = f.children[0];
  const request = f.transport.request("test", {});
  const response = JSON.stringify({ id: child.requests[0].id, result: { ok: true } }) + "\n";
  child.stdout.write(response.slice(0, 10));
  child.stdout.write(response.slice(10) + 'bad JSON\n{"method":"notification"}\n');
  assert.deepEqual(await request, { ok: true });
  assert.deepEqual(f.messages, [{ method: "notification" }]);
  assert.ok(f.logs.some(log => log.includes("invalid Codex")));
});

test("transport clears timers after response and rejects a missing response on timeout", async t => {
  const f = transportFixture(t);
  await f.transport.start();
  const nativeSetTimeout = globalThis.setTimeout;
  const timers = [];
  t.mock.method(globalThis, "setTimeout", (...args) => {
    const timer = nativeSetTimeout(...args);
    timers.push(timer);
    return timer;
  });
  const response = f.transport.request("success", {});
  f.children[0].reply(f.children[0].requests[0]);
  await response;
  assert.equal(timers[0]._destroyed, true);
  t.mock.restoreAll();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timedOut = assert.rejects(f.transport.request("missing", {}), /応答しません/);
  t.mock.timers.tick(60000);
  await timedOut;
});

test("transport stop rejects pending requests and restart ignores old buffers and child events", async t => {
  const f = transportFixture(t);
  await f.transport.start();
  const old = f.children[0];
  old.stdout.write('{"method":');
  const pending = assert.rejects(f.transport.request("pending", {}), /停止/);
  f.transport.stop();
  await pending;
  await f.transport.start();
  const child = f.children[1];
  old.stdout.write('"stale"}\n');
  old.emit("error", new Error("late error"));
  const response = f.transport.request("new", {});
  child.reply(child.requests[0], "fresh");
  assert.equal(await response, "fresh");
  assert.equal(f.transport.running, true);
  assert.deepEqual(f.messages, []);
});

test("transport stop during spawn rejects startup and permits a fresh start", async t => {
  const children = [];
  const transport = new CodexTransport({ onMessage() {}, onLog() {}, onExit() {} }, () => {
    const child = new FakeChild(); children.push(child); return child;
  });
  t.after(() => transport.stop());
  const stopped = assert.rejects(transport.start(), /停止/);
  transport.stop();
  children[0].emit("spawn");
  await stopped;
  const restarted = transport.start();
  children[1].emit("spawn");
  await restarted;
  assert.equal(children[0].killed, true);
});

test("transport handles spawn errors and stdin failures without hanging requests", async t => {
  const f = transportFixture(t);
  const start = assert.rejects(f.transport.start(), /起動に失敗/);
  f.children[0].emit("error", new Error("spawn failed"));
  await start;
  await f.transport.start();
  const response = assert.rejects(f.transport.request("test", {}), /broken pipe/);
  f.children[1].stdin.emit("error", new Error("broken pipe"));
  await response;
  assert.equal(f.transport.running, false);
});

test("client shares login/ask initialization, rejects duplicate asks, and streams a complete answer", async t => {
  const f = clientFixture(t);
  const answer = f.client.ask("question");
  const login = f.client.login();
  await assert.rejects(f.client.ask("duplicate"), /前の相談/);
  await flush();
  const child = f.children[0];
  assert.equal(f.children.length, 1);
  assert.equal(child.requests.filter(request => request.method === "initialize").length, 1);
  child.send({ method: "item/agentMessage/delta", params: { delta: "回答" } });
  child.send({ method: "item/agentMessage/delta", params: { delta: "です" } });
  finish(child);
  await Promise.all([answer, login]);
  assert.deepEqual(f.deltas, ["回答", "です"]);
  assert.equal(f.completed, 1);
  assert.deepEqual(f.authUrls, ["https://example.test/login"]);
  child.send({ method: "item/agentMessage/delta", params: { delta: "late" } });
  assert.equal(f.deltas.length, 2);
});

test("client reports failed completion and can ask again", async t => {
  const f = clientFixture(t);
  const failed = assert.rejects(f.client.ask("first"), /turn failed/);
  await flush();
  finish(f.children[0], "failed");
  await failed;
  const next = f.client.ask("next");
  await flush();
  finish(f.children[0]);
  await next;
  assert.equal(f.completed, 2);
});

test("client stop and process exit reject an active answer promptly", async t => {
  const f = clientFixture(t);
  const stopped = assert.rejects(f.client.ask("first"), /停止/);
  await flush();
  f.client.stop();
  await stopped;
  const exited = assert.rejects(f.client.ask("second"), /終了/);
  await flush();
  f.children[1].emit("exit", 1);
  await exited;
});

test("client answer timeout discards the old process and accepts a fresh answer", async t => {
  const f = clientFixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timedOut = assert.rejects(f.client.ask("first"), /回答がタイムアウト/);
  await flush();
  t.mock.timers.tick(180000);
  await timedOut;
  const next = f.client.ask("second");
  await flush();
  assert.equal(f.children.length, 2);
  f.children[0].send({ method: "item/agentMessage/delta", params: { delta: "stale" } });
  finish(f.children[0]);
  f.children[1].send({ method: "item/agentMessage/delta", params: { delta: "fresh" } });
  finish(f.children[1]);
  await next;
  assert.deepEqual(f.deltas, ["fresh"]);
});

test("client rejects turn/start RPC errors without leaving the answer timer alive", async t => {
  const f = clientFixture(t, (request, child) => child.send({ id: request.id, error: { message: "RPC failed" } }));
  await assert.rejects(f.client.ask("test"), /RPC failed/);
  assert.equal(f.children[0].killed, true);
});
