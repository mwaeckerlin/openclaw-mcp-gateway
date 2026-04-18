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

test("gateway-rpc reports transport error from ws error event", async () => {
  const ws = new FakeWebSocket();
  __testing.setWebSocketFactory(() => ws);

  const promise = callGatewayRpc(
    { baseUrl: "http://gateway.example.invalid", token: "token-value" },
    "cron.status",
    {},
    2_000
  );

  ws.emitOpen();
  ws.emit("error", new Error("connection refused"));

  await assert.rejects(
    promise,
    (error: unknown) => error instanceof GatewayRpcError && error.kind === "transport"
  );
  __testing.resetWebSocketFactory();
});

test("gateway-rpc reports protocol error when connection closes before connect response", async () => {
  const ws = new FakeWebSocket();
  __testing.setWebSocketFactory(() => ws);

  const promise = callGatewayRpc(
    { baseUrl: "http://gateway.example.invalid", token: "token-value" },
    "cron.list",
    {},
    2_000
  );

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  ws.emitClose(1006, "");

  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof GatewayRpcError &&
      (error.kind === "protocol" || error.kind === "auth")
  );
  __testing.resetWebSocketFactory();
});

test("gateway-rpc url converts http to ws and https to wss", async () => {
  const wsUrls: string[] = [];
  __testing.setWebSocketFactory((url) => {
    wsUrls.push(url);
    const ws = new FakeWebSocket();
    setTimeout(() => {
      ws.emitOpen();
      ws.emit("error", new Error("test done"));
    }, 0);
    return ws;
  });

  await assert.rejects(
    callGatewayRpc({ baseUrl: "https://gateway.example.invalid", token: "tok" }, "cron.status", {}, 500),
    (error: unknown) => error instanceof GatewayRpcError
  );

  assert.ok(wsUrls.some((u) => u.startsWith("wss://")), `expected wss:// url, got: ${wsUrls.join(", ")}`);
  __testing.resetWebSocketFactory();
});

// ---- cron.status ----

test("cron.status accepts empty arguments", () => {
  const params = validateCronToolArguments("openclaw_cron_status", {});
  assert.deepEqual(params, {});
});

test("cron.status rejects unknown fields", () => {
  assert.throws(
    () => validateCronToolArguments("openclaw_cron_status", { foo: true }),
    /foo/
  );
});

// ---- cron.list ----

test("cron.list accepts all valid filter fields", () => {
  const params = validateCronToolArguments("openclaw_cron_list", {
    limit: 10,
    offset: 0,
    includeDisabled: false,
    query: "test",
    enabled: "enabled",
    sortBy: "name",
    sortDir: "asc"
  });
  assert.equal(params.limit, 10);
  assert.equal(params.sortBy, "name");
});

test("cron.list rejects invalid sortBy value", () => {
  assert.throws(
    () => validateCronToolArguments("openclaw_cron_list", { sortBy: "createdAt" }),
    /sortBy/
  );
});

// ---- cron.add ----

test("cron.add accepts cron schedule kind", () => {
  const params = validateCronToolArguments("openclaw_cron_add", {
    name: "nightly",
    schedule: { kind: "cron", expr: "0 2 * * *", tz: "UTC" },
    sessionTarget: "main",
    wakeMode: "now",
    payload: { kind: "systemEvent", text: "run" }
  });
  assert.equal((params.schedule as Record<string, unknown>).kind, "cron");
});

test("cron.add accepts every schedule kind", () => {
  const params = validateCronToolArguments("openclaw_cron_add", {
    name: "heartbeat",
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "tick" }
  });
  assert.equal((params.schedule as Record<string, unknown>).kind, "every");
});

test("cron.add accepts agentTurn payload", () => {
  const params = validateCronToolArguments("openclaw_cron_add", {
    name: "agent-job",
    schedule: { kind: "at", at: "2026-06-01T00:00:00+00:00" },
    sessionTarget: "current",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "do it", model: "gpt-4", toolsAllow: ["search"] }
  });
  assert.equal((params.payload as Record<string, unknown>).kind, "agentTurn");
});

test("cron.add accepts failureAlert false", () => {
  const params = validateCronToolArguments("openclaw_cron_add", {
    name: "silent-job",
    schedule: { kind: "at", at: "2026-06-01T00:00:00+00:00" },
    sessionTarget: "main",
    wakeMode: "now",
    payload: { kind: "systemEvent", text: "go" },
    failureAlert: false
  });
  assert.equal(params.failureAlert, false);
});

test("cron.add accepts session:<id> sessionTarget", () => {
  const params = validateCronToolArguments("openclaw_cron_add", {
    name: "session-job",
    schedule: { kind: "at", at: "2026-06-01T00:00:00+00:00" },
    sessionTarget: "session:abc-123",
    wakeMode: "now",
    payload: { kind: "systemEvent", text: "go" }
  });
  assert.equal(params.sessionTarget, "session:abc-123");
});

// ---- cron.update ----

test("cron.update accepts id with patch", () => {
  const params = validateCronToolArguments("openclaw_cron_update", {
    id: "job-1",
    patch: { name: "updated-name", enabled: false }
  });
  assert.equal(params.id, "job-1");
});

test("cron.update accepts jobId with patch", () => {
  const params = validateCronToolArguments("openclaw_cron_update", {
    jobId: "my-job",
    patch: { enabled: true }
  });
  assert.equal(params.jobId, "my-job");
});

test("cron.update rejects both id and jobId", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_update", {
        id: "job-1",
        jobId: "job-1",
        patch: {}
      }),
    /exactly one of id or jobId/
  );
});

test("cron.update rejects neither id nor jobId", () => {
  assert.throws(
    () => validateCronToolArguments("openclaw_cron_update", { patch: {} }),
    /exactly one of id or jobId/
  );
});

test("cron.update rejects unknown patch fields", () => {
  assert.throws(
    () =>
      validateCronToolArguments("openclaw_cron_update", {
        id: "job-1",
        patch: { unknownField: true }
      }),
    /unknownField/
  );
});

// ---- cron.remove ----

test("cron.remove accepts id", () => {
  const params = validateCronToolArguments("openclaw_cron_remove", { id: "job-42" });
  assert.equal(params.id, "job-42");
});

test("cron.remove accepts jobId", () => {
  const params = validateCronToolArguments("openclaw_cron_remove", { jobId: "my-job-name" });
  assert.equal(params.jobId, "my-job-name");
});

test("cron.remove rejects both id and jobId", () => {
  assert.throws(
    () => validateCronToolArguments("openclaw_cron_remove", { id: "a", jobId: "b" }),
    /exactly one of id or jobId/
  );
});

test("cron.remove rejects neither id nor jobId", () => {
  assert.throws(
    () => validateCronToolArguments("openclaw_cron_remove", {}),
    /exactly one of id or jobId/
  );
});

// ---- cron.runs ----

test("cron.runs accepts valid pagination and filter params", () => {
  const params = validateCronToolArguments("openclaw_cron_runs", {
    scope: "job",
    id: "job-1",
    limit: 20,
    offset: 5,
    status: "ok",
    sortDir: "desc"
  });
  assert.equal(params.scope, "job");
  assert.equal(params.limit, 20);
  assert.equal(params.status, "ok");
});

test("cron.runs accepts statuses array", () => {
  const params = validateCronToolArguments("openclaw_cron_runs", {
    statuses: ["ok", "error"]
  });
  assert.deepEqual(params.statuses, ["ok", "error"]);
});

test("cron.runs rejects invalid entry in statuses array", () => {
  assert.throws(
    () => validateCronToolArguments("openclaw_cron_runs", { statuses: ["ok", "notastatus"] }),
    /notastatus/
  );
});

test("cron.runs rejects unknown field", () => {
  assert.throws(
    () => validateCronToolArguments("openclaw_cron_runs", { page: 1 }),
    /page/
  );
});
