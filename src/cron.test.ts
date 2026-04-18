import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { validateCronToolArguments } from "./cron.js";
import { __testing, callGatewayRpc, GatewayRpcError } from "./gateway-rpc.js";

class FakeWebSocket extends EventEmitter {
  public readonly sent: string[] = [];
  public readyState = 1;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  emitOpen(): void {
    this.emit("open");
  }

  emitMessage(payload: unknown): void {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.emit("message", Buffer.from(text, "utf8"));
  }

  emitClose(code: number, reason = ""): void {
    this.emit("close", code, Buffer.from(reason, "utf8"));
  }
}

function parseFrame(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

test("cron.add rejects invalid sessionTarget", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_add", {
        name: "job",
        schedule: { kind: "at", at: "2026-05-01T10:00:00+00:00" },
        sessionTarget: "bad",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "hello" }
      }),
    /sessionTarget/
  );
});

test("cron.add rejects invalid wakeMode", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_add", {
        name: "job",
        schedule: { kind: "at", at: "2026-05-01T10:00:00+00:00" },
        sessionTarget: "main",
        wakeMode: "later",
        payload: { kind: "systemEvent", text: "hello" }
      }),
    /wakeMode/
  );
});

test("cron.add rejects invalid schedule", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_add", {
        name: "job",
        schedule: { kind: "every", everyMs: 0 },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "hello" }
      }),
    /everyMs/
  );
});

test("cron.add rejects invalid delivery combination", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_add", {
        name: "job",
        schedule: { kind: "at", at: "2026-05-01T10:00:00+00:00" },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "go" },
        delivery: { mode: "webhook", to: "" }
      }),
    /delivery\.to/
  );
});

test("cron.add rejects invalid failureAlert shape", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_add", {
        name: "job",
        schedule: { kind: "at", at: "2026-05-01T10:00:00+00:00" },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "hello" },
        failureAlert: { after: 0 }
      }),
    /failureAlert\.after/
  );
});

test("cron.list rejects unknown top-level fields", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_list", {
        includeDisabled: true,
        unknownField: true
      }),
    /unknownField/
  );
});

test("cron.run accepts mode and id", () => {
  const params = validateCronToolArguments("openclaw_cron_run", {
    id: "job-123",
    mode: "force"
  });
  assert.deepEqual(params, { id: "job-123", mode: "force" });
});

test("gateway-rpc succeeds with challenge/connect/request flow", async () => {
  const ws = new FakeWebSocket();
  __testing.setWebSocketFactory(() => ws);

  const promise = callGatewayRpc(
    {
      baseUrl: "http://gateway.example.invalid",
      token: "token-value"
    },
    "cron.run",
    { id: "job-123", mode: "force" },
    2_000
  );

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge", payload: { nonce: "abc" } });

  const connectFrame = parseFrame(ws.sent[0]!);
  assert.equal(connectFrame.method, "connect");
  assert.equal(typeof connectFrame.id, "string");
  assert.equal((connectFrame.params as Record<string, unknown>).role, "operator");

  ws.emitMessage({
    type: "res",
    id: connectFrame.id,
    ok: true,
    payload: { ok: true }
  });

  const requestFrame = parseFrame(ws.sent[1]!);
  assert.equal(requestFrame.type, "req");
  assert.equal(requestFrame.method, "cron.run");
  assert.deepEqual(requestFrame.params, { id: "job-123", mode: "force" });

  ws.emitMessage({
    type: "res",
    id: requestFrame.id,
    ok: true,
    payload: { ok: true, enqueued: true, runId: "run-42" }
  });

  const result = await promise;
  assert.deepEqual(result, { ok: true, enqueued: true, runId: "run-42" });
  __testing.resetWebSocketFactory();
});

test("gateway-rpc times out waiting for method response", async () => {
  const ws = new FakeWebSocket();
  __testing.setWebSocketFactory(() => ws);

  const promise = callGatewayRpc(
    {
      baseUrl: "http://gateway.example.invalid",
      token: "token-value"
    },
    "cron.list",
    {},
    50
  );

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge", payload: { nonce: "abc" } });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: { ok: true } });

  await assert.rejects(
    promise,
    (error: unknown) => error instanceof GatewayRpcError && error.kind === "timeout"
  );
  __testing.resetWebSocketFactory();
});

test("gateway-rpc reports auth failure", async () => {
  const ws = new FakeWebSocket();
  __testing.setWebSocketFactory(() => ws);

  const promise = callGatewayRpc(
    {
      baseUrl: "http://gateway.example.invalid",
      token: "bad-token"
    },
    "cron.list",
    {},
    1_000
  );

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge", payload: { nonce: "abc" } });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({
    type: "res",
    id: connectFrame.id,
    ok: false,
    error: { code: "auth_failed", message: "token mismatch" }
  });

  await assert.rejects(
    promise,
    (error: unknown) => error instanceof GatewayRpcError && error.kind === "auth"
  );
  __testing.resetWebSocketFactory();
});

test("gateway-rpc reports non-ok method response", async () => {
  const ws = new FakeWebSocket();
  __testing.setWebSocketFactory(() => ws);

  const promise = callGatewayRpc(
    {
      baseUrl: "http://gateway.example.invalid",
      token: "token-value"
    },
    "cron.update",
    { id: "job-1", patch: {} },
    1_000
  );

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge", payload: { nonce: "abc" } });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: { ok: true } });
  const requestFrame = parseFrame(ws.sent[1]!);
  ws.emitMessage({
    type: "res",
    id: requestFrame.id,
    ok: false,
    error: { code: "validation_failed", message: "bad patch" }
  });

  await assert.rejects(
    promise,
    (error: unknown) => error instanceof GatewayRpcError && error.kind === "protocol"
  );
  __testing.resetWebSocketFactory();
});

test("gateway-rpc rejects malformed response frame", async () => {
  const ws = new FakeWebSocket();
  __testing.setWebSocketFactory(() => ws);

  const promise = callGatewayRpc(
    {
      baseUrl: "http://gateway.example.invalid",
      token: "token-value"
    },
    "cron.status",
    {},
    1_000
  );

  ws.emitOpen();
  ws.emitMessage("this is not json");

  await assert.rejects(
    promise,
    (error: unknown) => error instanceof GatewayRpcError && error.kind === "protocol"
  );
  __testing.resetWebSocketFactory();
});
