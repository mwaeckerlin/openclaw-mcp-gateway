import assert from "node:assert/strict";
import test from "node:test";
import { validateReadonlyRpcToolArguments, redactSensitive } from "./readonly-rpc-tools.js";

// ---------------------------------------------------------- validateReadonlyRpcToolArguments

test("openclaw_health: accepts valid args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_health", { verbose: true, timeoutMs: 5000 }));
});
test("openclaw_health: rejects timeoutMs out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_health", { timeoutMs: 500 }), /between 1000 and 120000/);
});
test("openclaw_health: rejects non-boolean verbose", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_health", { verbose: "yes" }), /must be a boolean/);
});

test("openclaw_status: accepts valid type values", () => {
  for (const type of ["default", "deep", "usage", "all"]) {
    assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_status", { type }));
  }
});
test("openclaw_status: rejects unknown type", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_status", { type: "full" }), /default, deep, usage, all/);
});
test("openclaw_status: accepts empty args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_status", {}));
});

test("openclaw_logs: accepts valid args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_logs", { limit: 100, format: "json", localTime: false }));
});
test("openclaw_logs: rejects limit out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_logs", { limit: 10000 }), /between 1 and 5000/);
});
test("openclaw_logs: rejects unknown format", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_logs", { format: "xml" }), /default, json, plain/);
});
test("openclaw_logs: rejects intervalMs out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_logs", { intervalMs: 50 }), /between 100 and 60000/);
});

test("openclaw_gateway_probe: accepts valid args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_gateway_probe", { requireRpc: true, deep: false, noProbe: false, timeoutMs: 5000 }));
});
test("openclaw_gateway_probe: rejects timeoutMs out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_gateway_probe", { timeoutMs: 100 }), /between 500 and 120000/);
});

test("openclaw_gateway_usage_cost: accepts days", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_gateway_usage_cost", { days: 30 }));
});
test("openclaw_gateway_usage_cost: rejects days out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_gateway_usage_cost", { days: 9999 }), /between 1 and 3650/);
});

test("openclaw_doctor: accepts valid args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_doctor", { deep: true, noWorkspaceSuggestions: false }));
});

test("openclaw_channels_status: accepts probe + timeoutMs", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_channels_status", { probe: true, timeoutMs: 8000 }));
});
test("openclaw_channels_status: rejects timeoutMs out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_channels_status", { timeoutMs: 200 }), /between 500 and 120000/);
});

test("openclaw_channels_capabilities: accepts optional channel/account/target", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_channels_capabilities", { channel: "telegram", account: "mybot" }));
});
test("openclaw_channels_capabilities: rejects empty channel", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_channels_capabilities", { channel: "" }), /non-empty string/);
});

test("openclaw_channels_resolve: requires entries", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_channels_resolve", {}), /entries must contain/i);
});
test("openclaw_channels_resolve: enforces bounded entries for channels resolve", () => {
  assert.throws(
    () => validateReadonlyRpcToolArguments("openclaw_channels_resolve", { entries: new Array(51).fill("@user") }),
    /at most 50/i
  );
});
test("openclaw_channels_resolve: accepts valid entries with kind", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_channels_resolve", { entries: ["@alice"], kind: "user" }));
});
test("openclaw_channels_resolve: rejects invalid kind", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_channels_resolve", { entries: ["#x"], kind: "org" }), /auto, user, group/);
});

test("openclaw_channels_logs: accepts valid args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_channels_logs", { channel: "telegram", lines: 50 }));
});
test("openclaw_channels_logs: rejects lines out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_channels_logs", { lines: 10000 }), /between 1 and 5000/);
});

test("openclaw_plugins_list: accepts enabledOnly + verbose", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_plugins_list", { enabledOnly: true, verbose: false }));
});

test("openclaw_plugins_inspect: requires id", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_plugins_inspect", {}), /id is required/);
});
test("openclaw_plugins_inspect: accepts id", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_plugins_inspect", { id: "my-plugin" }));
});

test("openclaw_models_status: accepts valid args", () => {
  assert.doesNotThrow(() =>
    validateReadonlyRpcToolArguments("openclaw_models_status", {
      check: true, probe: false, probeProvider: "openai",
      probeConcurrency: 4, probeMaxTokens: 200, probeTimeoutMs: 10000
    })
  );
});
test("openclaw_models_status: rejects probeProfileIds over limit", () => {
  assert.throws(
    () => validateReadonlyRpcToolArguments("openclaw_models_status", { probeProfileIds: new Array(51).fill("x") }),
    /at most 50/i
  );
});
test("openclaw_models_status: rejects probeConcurrency out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_models_status", { probeConcurrency: 100 }), /between 1 and 32/);
});
test("openclaw_models_status: rejects probeMaxTokens out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_models_status", { probeMaxTokens: 50000 }), /between 1 and 32000/);
});

test("openclaw_models_list: accepts agentId", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_models_list", { agentId: "agent-1" }));
});
test("openclaw_models_list: accepts empty args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_models_list", {}));
});

test("openclaw_config_get: requires path", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_config_get", {}), /path is required/);
});
test("openclaw_config_get: accepts valid path", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_config_get", { path: "server.port" }));
});

test("openclaw_config_schema_lookup: requires path for schema lookup", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_config_schema_lookup", {}), /path is required/i);
});
test("openclaw_config_schema_lookup: accepts valid path", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_config_schema_lookup", { path: "server.port" }));
});

test("openclaw_security_audit: accepts deep flag", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_security_audit", { deep: true }));
});

test("openclaw_secrets_audit: accepts allowExec + check", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_secrets_audit", { allowExec: false, check: true }));
});

test("openclaw_approvals_get: accepts target=gateway", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_approvals_get", { target: "gateway" }));
});
test("openclaw_approvals_get: target=node requires node field", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_approvals_get", { target: "node" }), /node is required/);
});
test("openclaw_approvals_get: target=node accepts node field", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_approvals_get", { target: "node", node: "node-123" }));
});
test("openclaw_approvals_get: rejects unknown target", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_approvals_get", { target: "cluster" }), /local, gateway, node/);
});

test("openclaw_nodes_list: accepts connectedOnly + lastConnected", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_nodes_list", { connectedOnly: true, lastConnected: "24h" }));
});
test("openclaw_nodes_status: accepts valid args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_nodes_status", { connectedOnly: false }));
});

test("openclaw_sandbox_explain: accepts optional sessionKey + agentId", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_sandbox_explain", { sessionKey: "main", agentId: "agent-1" }));
});
test("openclaw_sandbox_list: accepts browserOnly", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_sandbox_list", { browserOnly: true }));
});

// ---------------------------------------------------------- redactSensitive

test("redactSensitive removes token-like keys and bearer strings", () => {
  const input = {
    token: "abc123",
    nested: {
      Authorization: "Bearer super-secret-token",
      note: "safe"
    }
  };
  const output = redactSensitive(input) as Record<string, unknown>;
  assert.equal(output.token, "[REDACTED]");
  const nested = output.nested as Record<string, unknown>;
  assert.equal(nested.Authorization, "[REDACTED]");
  assert.equal(nested.note, "safe");
});

test("redactSensitive removes credential and access_key", () => {
  const input = { credential: "cred123", access_key: "ak123", safe: "value" };
  const output = redactSensitive(input) as Record<string, unknown>;
  assert.equal(output.credential, "[REDACTED]");
  assert.equal(output.access_key, "[REDACTED]");
  assert.equal(output.safe, "value");
});

test("redactSensitive redacts Bearer tokens inside strings", () => {
  const output = redactSensitive("Authorization: Bearer eyJa.secret.part") as string;
  assert.ok(output.includes("[REDACTED]"));
  assert.ok(!output.includes("eyJa.secret.part"));
});

test("redactSensitive passes through safe primitive values unchanged", () => {
  assert.equal(redactSensitive(42), 42);
  assert.equal(redactSensitive(true), true);
  assert.equal(redactSensitive(null), null);
});

test("redactSensitive processes nested objects recursively", () => {
  const input = { outer: { inner: { password: "secret", name: "alice" } } };
  const output = redactSensitive(input) as Record<string, unknown>;
  const inner = (output.outer as Record<string, unknown>).inner as Record<string, unknown>;
  assert.equal(inner.password, "[REDACTED]");
  assert.equal(inner.name, "alice");
});

test("redactSensitive truncates arrays at MAX_ARRAY_ELEMENTS_FOR_REDACTION", () => {
  const big = new Array(500).fill({ value: "x" });
  const result = redactSensitive(big) as unknown[];
  assert.equal(result.length, 300);
});

