import assert from "node:assert/strict";
import test from "node:test";
import { validateReadonlyRpcToolArguments, redactSensitive } from "./readonly-rpc-tools.js";

test("validateReadonlyRpcToolArguments enforces bounded entries for channels resolve", () => {
  assert.throws(
    () =>
      validateReadonlyRpcToolArguments("openclaw_channels_resolve", {
        entries: new Array(51).fill("@user")
      }),
    /at most 50/i
  );
});

test("validateReadonlyRpcToolArguments requires config path for schema lookup", () => {
  assert.throws(
    () => validateReadonlyRpcToolArguments("openclaw_config_schema_lookup", {}),
    /path is required/i
  );
});

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
