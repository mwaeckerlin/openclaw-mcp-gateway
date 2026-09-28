import assert from "node:assert/strict";
import test from "node:test";
import { validateReadonlyRpcToolArguments, redactSensitive, registerSecretValue } from "./readonly-rpc-tools.js";

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

test("openclaw_channels_logs: accepts valid args", () => {
  assert.doesNotThrow(() => validateReadonlyRpcToolArguments("openclaw_channels_logs", { channel: "telegram", lines: 50 }));
});
test("openclaw_channels_logs: rejects lines out of range", () => {
  assert.throws(() => validateReadonlyRpcToolArguments("openclaw_channels_logs", { lines: 10000 }), /between 1 and 5000/);
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

// every credential format a gateway log line or a free-text field can carry;
// each must disappear from the text the sandbox receives. The fake tokens
// are joined at run time: written out whole, GitHub's push protection takes
// them for real secrets and refuses the push.
const token = (...parts: string[]): string => parts.join("");
const TELEGRAM = token("123456789", ":", "AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0");
const TOKENS_IN_TEXT: Array<[string, string]> = [
  ["telegram bot token", TELEGRAM],
  ["telegram bot URL", `https://api.telegram.org/bot${TELEGRAM}/getMe`],
  ["slack bot token", token("xox", "b-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx")],
  ["slack app token", token("xa", "pp-1-A0123456789-1234567890123-abcdef0123456789abcdef")],
  ["github classic token", token("gh", "p_16C7e42F292c6912E7710c838347Ae178B4a")],
  ["github fine-grained token", token("github", "_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEF")],
  ["discord bot token", token("MTEyNjQ5ODgxMjM0NTY3ODkw", ".", "GhIjKl", ".", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")],
  ["google api key", token("AI", "zaSyD-1234567890abcdefghijklmnopqrstu")],
  ["notion token", token("ntn", "_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH")],
  ["notion legacy token", token("secret", "_abcdefghijklmnopqrstuvwxyz0123456789ABCDE")],
  ["jwt", token("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")],
  ["password in url", "https://alice:hunter2secret@gitea.example/api"],
  ["key value pair", "botToken=AbCdEf0123456789secretvalue"],
  ["json key value", '"apiKey":"AbCdEf0123456789secretvalue"'],
  ["anthropic key", token("sk-", "ant-api03-AbCdEf0123456789AbCdEf0123456789")],
];

for (const [kind, token] of TOKENS_IN_TEXT) {
  test(`redactSensitive removes a ${kind} from free text`, () => {
    const secret = kind === "password in url" ? "hunter2secret" : kind.includes("key value") || kind === "json key value" ? "AbCdEf0123456789secretvalue" : token.replace(/^https:\/\/api\.telegram\.org\/bot|\/getMe$/g, "");
    const output = redactSensitive(`2026-09-28 [gateway] channel error: ${token} failed`) as string;
    assert.ok(!output.includes(secret), `${kind} survived: ${output}`);
    assert.ok(output.includes("[REDACTED]"), output);
    assert.ok(output.startsWith("2026-09-28 [gateway] channel error:"), output);
  });
}

test("redactSensitive removes a registered secret by its exact value, whatever its shape", () => {
  registerSecretValue("plain-looking-gateway-token-without-pattern");
  const output = redactSensitive({ lines: ["connect with plain-looking-gateway-token-without-pattern ok"] }) as { lines: string[] };
  assert.equal(output.lines[0], "connect with [REDACTED] ok");
});

test("redactSensitive keeps ordinary log text", () => {
  const line = "2026-09-28 [telegram:default] health-monitor: skipping restart, terminal-disconnect at 12:34:56";
  assert.equal(redactSensitive(line), line);
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

