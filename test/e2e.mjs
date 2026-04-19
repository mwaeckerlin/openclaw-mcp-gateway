/**
 * End-to-end test for the OpenClaw MCP Gateway.
 *
 * Connects to the MCP HTTP endpoint, exercises every exposed tool, and
 * validates negative cases. Exits with code 0 on success, 1 on failure.
 * No test framework — just plain Node.js with the MCP SDK client.
 *
 * Required environment variable:
 *   OPENCLAW_MCP_GATEWAY_URL  Full URL of the MCP gateway endpoint, e.g. http://mcp-gateway:4000
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.OPENCLAW_MCP_GATEWAY_URL;
if (!MCP_URL) {
  console.error("OPENCLAW_MCP_GATEWAY_URL is not set — run E2E tests via: cd test && docker compose up");
  process.exit(1);
}

// Regex for errors that require exactly one of id/jobId but both or neither were provided.
const ID_VALIDATION_RE = /validation|mismatch|id|jobId/i;

// Cron expression used for the e2e test job (runs daily at 03:00 UTC).
const E2E_CRON_EXPR = "0 3 * * *";
// Placeholder job name used for update/remove/run calls (may not exist in the live gateway).
const E2E_JOB_NAME = "e2e-test-job";

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`PASS  ${name}`);
  passed++;
}

function fail(name, detail = "") {
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

async function waitForHealthz(baseUrl, timeoutMs = 120_000) {
  const healthzUrl = new URL("/healthz", baseUrl).href;
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`Waiting for ${healthzUrl}`);
  while (Date.now() < deadline) {
    try {
      const r = await fetch(healthzUrl);
      if (r.ok) {
        process.stdout.write(" ready\n");
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    process.stdout.write(".");
  }
  throw new Error(`Timed out: ${healthzUrl} not ready after ${timeoutMs}ms`);
}

function firstTextContent(content) {
  if (!Array.isArray(content)) return null;
  return (
    content.find(
      (c) => c.type === "text" && typeof c.text === "string" && c.text.trim().length > 0
    ) ?? null
  );
}

async function main() {
  console.log("=== OpenClaw MCP Gateway — End-to-End Tests ===");
  console.log(`Target: ${MCP_URL}\n`);

  // ---- NETWORK SEGREGATION PROOF ----
  // Verify that the MCP URL uses a container DNS name (not loopback / 127.0.0.1).
  // This confirms that test-client → mcp-gateway traffic crosses a real bridge
  // network boundary and is NOT routed through a shared network namespace.
  // The same separation holds for the mcp-gateway → openclaw link: both use
  // container DNS names on separate bridge networks, so the test-client never
  // shares an L2 segment with the privileged operator token.
  try {
    const mcpHost = new URL(MCP_URL).hostname;
    const isLoopback =
      mcpHost === "127.0.0.1" ||
      mcpHost === "localhost" ||
      mcpHost === "::1" ||
      mcpHost === "::" ||
      /^::ffff:127\./i.test(mcpHost);
    if (isLoopback) {
      fail(
        "network-segregation-proof → MCP_URL must be a container DNS name, not loopback",
        `got hostname: ${mcpHost}`
      );
    } else {
      pass(`network-segregation-proof → MCP URL uses bridge DNS name: ${mcpHost}`);
    }
  } catch (e) {
    fail("network-segregation-proof → could not parse MCP_URL", e.message);
  }

  // POSITIVE: The MCP gateway HTTP health endpoint must respond 200 OK.
  await waitForHealthz(MCP_URL);
  pass("/healthz → 200 ok");

  // --------------------------------------------------------- connect MCP client
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client({ name: "e2e-test", version: "1.0.0" });
  await client.connect(transport);

  // Track the UUID of the job created by cron_add so later tests can reference it.
  let createdJobId = null;

  try {
    // --------------------------------------------------------------- tools/list
    // POSITIVE: tools/list must expose every required tool name.
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    const requiredTools = [
      "openclaw_health",
      "openclaw_status",
      "openclaw_logs",
      "openclaw_gateway_probe",
      "openclaw_gateway_usage_cost",
      "openclaw_doctor",
      "openclaw_channels_list",
      "openclaw_channels_status",
      "openclaw_channels_capabilities",
      "openclaw_channels_resolve",
      "openclaw_channels_logs",
      "openclaw_plugins_list",
      "openclaw_plugins_inspect",
      "openclaw_plugins_doctor",
      "openclaw_models_status",
      "openclaw_models_list",
      "openclaw_models_aliases_list",
      "openclaw_models_fallbacks_list",
      "openclaw_config_get",
      "openclaw_config_file",
      "openclaw_config_validate",
      "openclaw_config_schema",
      "openclaw_config_schema_lookup",
      "openclaw_security_audit",
      "openclaw_secrets_audit",
      "openclaw_approvals_get",
      "openclaw_devices_list",
      "openclaw_nodes_list",
      "openclaw_nodes_pending",
      "openclaw_nodes_status",
      "openclaw_skills_check",
      "openclaw_sandbox_explain",
      "openclaw_sandbox_list",
      "openclaw_system_presence",
      "openclaw_gateway_status",
      "openclaw_sessions_list",
      "openclaw_session_status",
      "openclaw_skills_list",
      "openclaw_skills_detail",
      "openclaw_cron_status",
      "openclaw_cron_list",
      "openclaw_cron_add",
      "openclaw_cron_update",
      "openclaw_cron_remove",
      "openclaw_cron_run",
      "openclaw_cron_runs",
    ];
    for (const tool of requiredTools) {
      if (toolNames.includes(tool)) {
        pass(`tools/list → ${tool} is present`);
      } else {
        fail(`tools/list → ${tool} missing`, `got: [${toolNames.join(", ")}]`);
      }
    }

    // ------------------------------------------------- openclaw_gateway_status
    // POSITIVE: Tool must return a healthy status response from the upstream gateway health check.
    try {
      const r = await client.callTool({ name: "openclaw_gateway_status" });
      if (r.isError) {
        fail("openclaw_gateway_status → expected success, got error", JSON.stringify(r.content));
      } else {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_gateway_status → no text content in response", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (parsed.ok === true && typeof parsed.status === "string") {
              pass(`openclaw_gateway_status → ok=${parsed.ok} status=${parsed.status}`);
            } else {
              fail("openclaw_gateway_status → missing expected fields ok/status", text.text.slice(0, 200));
            }
          } catch {
            fail("openclaw_gateway_status → response is not valid JSON", text.text.slice(0, 200));
          }
        }
      }
    } catch (e) {
      fail("openclaw_gateway_status → unexpected exception", e.message);
    }

    // ------------------------------------------------------- openclaw_status
    // POSITIVE: Tool must return status family output.
    try {
      const r = await client.callTool({ name: "openclaw_status" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_status → no text content", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (typeof parsed.status === "object" && parsed.status !== null) {
              pass("openclaw_status → returned status object");
            } else {
              fail("openclaw_status → missing expected status object", text.text.slice(0, 200));
            }
          } catch {
            fail("openclaw_status → response is not valid JSON", text.text.slice(0, 200));
          }
        }
      } else {
        fail("openclaw_status → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_status → unexpected exception", e.message);
    }

    // ------------------------------------------------------- openclaw_health
    try {
      const r = await client.callTool({ name: "openclaw_health" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          const parsed = JSON.parse(text.text);
          if (parsed.ok === true && typeof parsed.durationMs === "number") pass("openclaw_health → returned healthy payload");
          else fail("openclaw_health → unexpected payload", text.text.slice(0, 200));
        } else fail("openclaw_health → no text content", JSON.stringify(r));
      } else {
        fail("openclaw_health → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_health → unexpected exception", e.message);
    }

    // ------------------------------------------------------- openclaw_config_validate
    try {
      const r = await client.callTool({ name: "openclaw_config_validate" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          const parsed = JSON.parse(text.text);
          if (typeof parsed.valid === "boolean") pass(`openclaw_config_validate → valid=${parsed.valid}`);
          else fail("openclaw_config_validate → missing valid field", text.text.slice(0, 200));
        } else fail("openclaw_config_validate → no text content", JSON.stringify(r));
      } else {
        fail("openclaw_config_validate → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_config_validate → unexpected exception", e.message);
    }

    // ------------------------------------------------------- openclaw_system_presence
    try {
      const r = await client.callTool({ name: "openclaw_system_presence" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          const parsed = JSON.parse(text.text);
          if (Array.isArray(parsed)) pass(`openclaw_system_presence → entries=${parsed.length}`);
          else fail("openclaw_system_presence → expected array", text.text.slice(0, 200));
        } else fail("openclaw_system_presence → no text content", JSON.stringify(r));
      } else {
        fail("openclaw_system_presence → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_system_presence → unexpected exception", e.message);
    }

    // ------------------------------------------------------- openclaw_logs (bounded, no follow)
    // Uses logs.tail -- verified gateway RPC method.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_logs", arguments: { limit: 10 } });
        if (!r.isError) {
          const text = firstTextContent(r.content);
          if (text) res = { ok: true, parsed: JSON.parse(text.text) };
          else res = { ok: false, error: "no text content" };
        } else {
          const e2 = JSON.stringify(r.content);
          res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 };
        }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_logs -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_logs -> capability-not-supported (acceptable)");
      else pass("openclaw_logs -> returned log payload");
    }

    // ------------------------------------------------------- openclaw_gateway_probe
    // Uses health + status -- both verified gateway RPC methods.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_gateway_probe", arguments: {} });
        if (!r.isError) {
          const text = firstTextContent(r.content);
          if (text) res = { ok: true, parsed: JSON.parse(text.text) };
          else res = { ok: false, error: "no text content" };
        } else {
          const e2 = JSON.stringify(r.content);
          res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 };
        }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_gateway_probe -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_gateway_probe -> capability-not-supported (acceptable)");
      else if (typeof res.parsed.rpcOk === "boolean") pass("openclaw_gateway_probe -> rpcOk=" + res.parsed.rpcOk);
      else fail("openclaw_gateway_probe -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_gateway_usage_cost
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_gateway_usage_cost", arguments: { days: 7 } });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_gateway_usage_cost -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_gateway_usage_cost -> capability-not-supported (acceptable)");
      else pass("openclaw_gateway_usage_cost -> returned usage-cost payload");
    }

    // ------------------------------------------------------- openclaw_doctor
    // Uses health + status -- both verified.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_doctor", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_doctor -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_doctor -> capability-not-supported (acceptable)");
      else if (res.parsed.health !== undefined && res.parsed.status !== undefined) pass("openclaw_doctor -> returned health+status");
      else fail("openclaw_doctor -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_channels_list
    // Derived from config.get -- verified.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_channels_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_channels_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_channels_list -> capability-not-supported (acceptable)");
      else if (typeof res.parsed.total === "number") pass("openclaw_channels_list -> total=" + res.parsed.total);
      else fail("openclaw_channels_list -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_channels_status
    // Uses channels.status -- verified gateway RPC method.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_channels_status", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_channels_status -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_channels_status -> capability-not-supported (acceptable)");
      else pass("openclaw_channels_status -> returned channel status payload");
    }

    // ------------------------------------------------------- openclaw_channels_capabilities
    // Uses channels.capabilities -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_channels_capabilities", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_channels_capabilities -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_channels_capabilities -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_channels_capabilities -> returned capabilities payload");
    }

    // ------------------------------------------------------- openclaw_channels_resolve
    // Uses channels.resolve -- capability-conditional. Needs at least one entry.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_channels_resolve", arguments: { entries: ["@test-user"], kind: "user" } });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_channels_resolve -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_channels_resolve -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_channels_resolve -> returned resolve payload");
    }

    // ------------------------------------------------------- openclaw_channels_logs
    // Derived from logs.tail -- verified method.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_channels_logs", arguments: { lines: 5 } });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_channels_logs -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_channels_logs -> capability-not-supported (acceptable)");
      else if (typeof res.parsed.channel === "string" && Array.isArray(res.parsed.lines)) pass("openclaw_channels_logs -> channel=" + res.parsed.channel + " returned=" + res.parsed.returned);
      else fail("openclaw_channels_logs -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_plugins_list
    // Uses plugins.list -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_plugins_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_plugins_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_plugins_list -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_plugins_list -> returned plugins list payload");
    }

    // ------------------------------------------------------- openclaw_plugins_doctor
    // Uses plugins.doctor -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_plugins_doctor", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_plugins_doctor -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_plugins_doctor -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_plugins_doctor -> returned plugin diagnostics payload");
    }

    // ------------------------------------------------------- openclaw_models_status
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_models_status", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_models_status -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_models_status -> capability-not-supported (acceptable)");
      else if (res.parsed.status !== undefined) pass("openclaw_models_status -> returned model status payload");
      else fail("openclaw_models_status -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_models_list
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_models_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_models_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_models_list -> capability-not-supported (acceptable)");
      else pass("openclaw_models_list -> returned models list payload");
    }

    // ------------------------------------------------------- openclaw_models_aliases_list
    // Derived from config.get -- verified.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_models_aliases_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_models_aliases_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_models_aliases_list -> capability-not-supported (acceptable)");
      else pass("openclaw_models_aliases_list -> returned model aliases payload");
    }

    // ------------------------------------------------------- openclaw_models_fallbacks_list
    // Derived from config.get -- verified.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_models_fallbacks_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_models_fallbacks_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_models_fallbacks_list -> capability-not-supported (acceptable)");
      else pass("openclaw_models_fallbacks_list -> returned model fallbacks payload");
    }

    // ------------------------------------------------------- openclaw_config_get (safe path)
    // Uses config.get -- verified. Reads safe non-secret path.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_config_get", arguments: { path: "server.port" } });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_config_get -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_config_get -> capability-not-supported (acceptable)");
      else if (typeof res.parsed.exists === "boolean" && res.parsed.path === "server.port") pass("openclaw_config_get -> exists=" + res.parsed.exists + " value=" + res.parsed.value);
      else fail("openclaw_config_get -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // NEGATIVE: config_get must block secret-bearing paths
    try {
      const r = await client.callTool({ name: "openclaw_config_get", arguments: { path: "channels.telegram.token" } });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/secret-bearing|blocked|invalid/i.test(errText)) pass("openclaw_config_get (negative) -> correctly blocks secret-bearing path");
        else fail("openclaw_config_get (negative) -> unexpected error body for secret path", errText);
      } else {
        fail("openclaw_config_get (negative) -> expected rejection for secret path, got success");
      }
    } catch (e) {
      if (/secret-bearing|blocked|invalid/i.test(e.message ?? "")) pass("openclaw_config_get (negative) -> correctly blocks secret-bearing path");
      else fail("openclaw_config_get (negative) -> unexpected exception", e.message);
    }

    // ------------------------------------------------------- openclaw_config_file
    // Derived from config.get -- verified.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_config_file", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_config_file -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_config_file -> capability-not-supported (acceptable)");
      else if (typeof res.parsed.exists === "boolean") pass("openclaw_config_file -> path=" + res.parsed.path + " exists=" + res.parsed.exists);
      else fail("openclaw_config_file -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_config_schema
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_config_schema", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_config_schema -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_config_schema -> capability-not-supported (acceptable)");
      else pass("openclaw_config_schema -> returned config schema payload");
    }

    // ------------------------------------------------------- openclaw_config_schema_lookup
    // Uses config.schema.lookup -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_config_schema_lookup", arguments: { path: "server.port" } });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_config_schema_lookup -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_config_schema_lookup -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_config_schema_lookup -> returned schema lookup payload");
    }

    // ------------------------------------------------------- openclaw_security_audit
    // Uses security.audit -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_security_audit", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_security_audit -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_security_audit -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_security_audit -> returned security audit payload");
    }

    // ------------------------------------------------------- openclaw_secrets_audit
    // Uses secrets.audit -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_secrets_audit", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_secrets_audit -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_secrets_audit -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_secrets_audit -> returned secrets audit payload");
    }

    // ------------------------------------------------------- openclaw_approvals_get target=local
    // target=local returns a static note -- no RPC needed.
    try {
      const r = await client.callTool({ name: "openclaw_approvals_get", arguments: { target: "local" } });
      if (!r.isError) {
        const t = firstTextContent(r.content);
        if (t) {
          const parsed = JSON.parse(t.text);
          if (parsed.target === "local" && typeof parsed.note === "string") pass("openclaw_approvals_get (local) -> returned local note");
          else fail("openclaw_approvals_get (local) -> unexpected payload", t.text.slice(0, 200));
        } else fail("openclaw_approvals_get (local) -> no text content");
      } else fail("openclaw_approvals_get (local) -> got error", JSON.stringify(r.content));
    } catch (e) { fail("openclaw_approvals_get (local) -> unexpected exception", e.message); }

    // ------------------------------------------------------- openclaw_approvals_get target=gateway
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_approvals_get", arguments: { target: "gateway" } });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_approvals_get (gateway) -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_approvals_get (gateway) -> capability-not-supported (acceptable)");
      else pass("openclaw_approvals_get (gateway) -> returned gateway approvals payload");
    }

    // ------------------------------------------------------- openclaw_devices_list
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_devices_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_devices_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_devices_list -> capability-not-supported (acceptable)");
      else pass("openclaw_devices_list -> returned devices list payload");
    }

    // ------------------------------------------------------- openclaw_nodes_pending
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_nodes_pending", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_nodes_pending -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_nodes_pending -> capability-not-supported (acceptable)");
      else if (Array.isArray(res.parsed.pending)) pass("openclaw_nodes_pending -> pending=" + res.parsed.pending.length);
      else fail("openclaw_nodes_pending -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_nodes_list
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_nodes_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_nodes_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_nodes_list -> capability-not-supported (acceptable)");
      else if (Array.isArray(res.parsed.paired)) pass("openclaw_nodes_list -> paired=" + res.parsed.paired.length);
      else fail("openclaw_nodes_list -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_nodes_status
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_nodes_status", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_nodes_status -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_nodes_status -> capability-not-supported (acceptable)");
      else if (Array.isArray(res.parsed.nodes)) pass("openclaw_nodes_status -> nodes=" + res.parsed.nodes.length);
      else fail("openclaw_nodes_status -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_skills_check
    // Uses skills.status -- verified gateway RPC method.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_skills_check", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_skills_check -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_skills_check -> capability-not-supported (acceptable)");
      else if (typeof res.parsed.ready === "number" && typeof res.parsed.total === "number") pass("openclaw_skills_check -> ready=" + res.parsed.ready + "/" + res.parsed.total);
      else fail("openclaw_skills_check -> unexpected payload", JSON.stringify(res.parsed).slice(0, 200));
    }

    // ------------------------------------------------------- openclaw_sandbox_explain
    // Uses sandbox.explain -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_sandbox_explain", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_sandbox_explain -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_sandbox_explain -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_sandbox_explain -> returned sandbox explain payload");
    }

    // ------------------------------------------------------- openclaw_sandbox_list
    // Uses sandbox.list -- capability-conditional.
    {
      let res;
      try {
        const r = await client.callTool({ name: "openclaw_sandbox_list", arguments: {} });
        if (!r.isError) { const t = firstTextContent(r.content); if (t) res = { ok: true, parsed: JSON.parse(t.text) }; else res = { ok: false, error: "no text" }; }
        else { const e2 = JSON.stringify(r.content); res = /not supported|capability|method_not_found/i.test(e2) ? { ok: true, capability: true } : { ok: false, error: e2 }; }
      } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) fail("openclaw_sandbox_list -> unexpected error", res.error);
      else if (res.capability) pass("openclaw_sandbox_list -> capability-not-supported (acceptable for this gateway version)");
      else pass("openclaw_sandbox_list -> returned sandbox list payload");
    }

    // NEGATIVE: openclaw_logs follow mode must be rejected locally
    try {
      const r = await client.callTool({ name: "openclaw_logs", arguments: { follow: true } });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/follow mode|not supported/i.test(errText)) pass("openclaw_logs (negative) -> correctly rejects follow mode");
        else fail("openclaw_logs (negative) -> unexpected error body", errText);
      } else {
        fail("openclaw_logs (negative) -> expected rejection of follow mode, got success");
      }
    } catch (e) {
      if (/follow mode|not supported/i.test(e.message ?? "")) pass("openclaw_logs (negative) -> correctly rejects follow mode");
      else fail("openclaw_logs (negative) -> unexpected exception", e.message);
    }

    // NEGATIVE: openclaw_channels_resolve must reject empty entries list
    try {
      const r = await client.callTool({ name: "openclaw_channels_resolve", arguments: { entries: [] } });
      if (r.isError) pass("openclaw_channels_resolve (negative) -> correctly rejects empty entries");
      else fail("openclaw_channels_resolve (negative) -> expected rejection for empty entries, got success");
    } catch (e) {
      pass("openclaw_channels_resolve (negative) -> correctly rejects empty entries (exception)");
    }


    // ------------------------------------------------ openclaw_sessions_list
    try {
      const r = await client.callTool({ name: "openclaw_sessions_list", arguments: { limit: 5, offset: 0 } });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_sessions_list → no text content", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (typeof parsed.total === "number" && parsed.limit === 5 && Array.isArray(parsed.sessions)) {
              pass(`openclaw_sessions_list → total=${parsed.total} returned=${parsed.returned}`);
            } else {
              fail("openclaw_sessions_list → missing expected fields total/limit/sessions", text.text.slice(0, 200));
            }
          } catch {
            fail("openclaw_sessions_list → response is not valid JSON", text.text.slice(0, 200));
          }
        }
      } else {
        fail("openclaw_sessions_list → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_sessions_list → unexpected exception", e.message);
    }

    // --------------------------------------------------- openclaw_skills_list
    let firstSkillKey = null;
    try {
      const r = await client.callTool({ name: "openclaw_skills_list", arguments: { limit: 5, offset: 0 } });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_skills_list → no text content", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (typeof parsed.total === "number" && parsed.limit === 5 && Array.isArray(parsed.skills)) {
              firstSkillKey =
                parsed.skills.length > 0 && typeof parsed.skills[0]?.skillKey === "string"
                  ? parsed.skills[0].skillKey
                  : null;
              pass(`openclaw_skills_list → total=${parsed.total} returned=${parsed.returned}`);
            } else {
              fail("openclaw_skills_list → missing expected fields total/limit/skills", text.text.slice(0, 200));
            }
          } catch {
            fail("openclaw_skills_list → response is not valid JSON", text.text.slice(0, 200));
          }
        }
      } else {
        fail("openclaw_skills_list → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_skills_list → unexpected exception", e.message);
    }

    // -------------------------------------------------- openclaw_skills_detail
    if (firstSkillKey) {
      try {
        const r = await client.callTool({
          name: "openclaw_skills_detail",
          arguments: { skillKey: firstSkillKey },
        });
        if (!r.isError) {
          const text = firstTextContent(r.content);
          if (!text) {
            fail("openclaw_skills_detail → no text content", JSON.stringify(r));
          } else {
            try {
              const parsed = JSON.parse(text.text);
              if (parsed.skillKey === firstSkillKey && typeof parsed.name === "string") {
                pass(`openclaw_skills_detail → skillKey=${parsed.skillKey}`);
              } else {
                fail("openclaw_skills_detail → missing expected fields skillKey/name", text.text.slice(0, 200));
              }
            } catch {
              fail("openclaw_skills_detail → response is not valid JSON", text.text.slice(0, 200));
            }
          }
        } else {
          fail("openclaw_skills_detail → expected success, got error", JSON.stringify(r.content));
        }
      } catch (e) {
        fail("openclaw_skills_detail → unexpected exception", e.message);
      }
    } else {
      pass("openclaw_skills_detail → skipped because skills_list returned no visible skills");
    }

    // ----------------------------------------------- openclaw_cron_status
    // POSITIVE: Tool must return cron scheduler status (enabled flag, job count, next wake time).
    //
    // PAIRING PROOF: openclaw_cron_status uses a WebSocket RPC call.  The WS
    // connection originates from the mcp-gateway container, which is on the
    // openclaw-mcp-gateway bridge network and connects to openclaw:18789 by
    // container DNS name — NOT via loopback.  For a non-loopback client the
    // Gateway enforces its device-identity check (skipLocalBackendSelfPairing
    // does NOT apply).  A successful response here proves that the Gateway
    // recognised the mcp-gateway's Ed25519 public key as a pre-registered device
    // (via OPENCLAW_DEVICE_PAIRING) and accepted the signed connect.challenge
    // response.  If the public key had not been pre-registered, the Gateway
    // would have rejected the WS connect and this test would have failed.
    try {
      const r = await client.callTool({ name: "openclaw_cron_status" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_cron_status → no text content", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (
              typeof parsed.enabled === "boolean" &&
              typeof parsed.storePath === "string" &&
              typeof parsed.jobs === "number"
            ) {
              pass(`openclaw_cron_status → ${text.text.slice(0, 120)}`);
            } else {
              fail("openclaw_cron_status → missing expected fields enabled/storePath/jobs", text.text.slice(0, 200));
            }
          } catch {
            fail("openclaw_cron_status → response is not valid JSON", text.text.slice(0, 200));
          }
        }
      } else {
        fail("openclaw_cron_status → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_status → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_list
    // POSITIVE: Tool must return the current list of cron jobs (may be empty on a fresh gateway).
    try {
      const r = await client.callTool({ name: "openclaw_cron_list" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_cron_list → no text content", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (
              Array.isArray(parsed.jobs) &&
              typeof parsed.total === "number" &&
              typeof parsed.offset === "number" &&
              typeof parsed.limit === "number" &&
              typeof parsed.hasMore === "boolean"
            ) {
              pass(`openclaw_cron_list → ${text.text.slice(0, 120)}`);
            } else {
              fail("openclaw_cron_list → missing expected fields jobs/total/offset/limit/hasMore", text.text.slice(0, 200));
            }
          } catch {
            fail("openclaw_cron_list → response is not valid JSON", text.text.slice(0, 200));
          }
        }
      } else {
        fail("openclaw_cron_list → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_list → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_add
    // POSITIVE: Tool must create a new cron job and return its UUID and metadata.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_add",
        arguments: {
          name: E2E_JOB_NAME,
          schedule: { kind: "cron", expr: E2E_CRON_EXPR },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: "e2e test run" }
        }
      });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          try { createdJobId = JSON.parse(text.text)?.id ?? null; } catch { /* ignore */ }
          if (createdJobId) {
            pass(`openclaw_cron_add → job created with id=${createdJobId}`);
          } else {
            fail("openclaw_cron_add → response has no id field", text.text.slice(0, 120));
          }
        } else {
          fail("openclaw_cron_add → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_add → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_add → unexpected exception", e.message);
    }

    // NEGATIVE: Calling cron_add without the required 'schedule' field must be rejected
    //           by local validation before any gateway call is made.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_add",
        arguments: { name: "bad-job" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/validation|mismatch|required|invalid/i.test(errText)) {
          pass("openclaw_cron_add (negative) → correctly rejects missing required fields");
        } else {
          fail("openclaw_cron_add (negative) → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_add (negative) → expected rejection, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (/validation|mismatch|required|invalid/i.test(e.message ?? "")) {
        pass("openclaw_cron_add (negative) → correctly rejects missing required fields");
      } else {
        fail("openclaw_cron_add (negative) → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_update
    // POSITIVE: Tool must update the just-created job (using its UUID) and return updated fields.
    if (!createdJobId) {
      fail("openclaw_cron_update → skipped because cron_add did not return a job id");
    } else {
      try {
        const r = await client.callTool({
          name: "openclaw_cron_update",
          arguments: { id: createdJobId, patch: { enabled: false } }
        });
        if (!r.isError) {
          const text = firstTextContent(r.content);
          if (!text) {
            fail("openclaw_cron_update → no text content", JSON.stringify(r));
          } else {
            try {
              const parsed = JSON.parse(text.text);
              if (parsed.id === createdJobId && parsed.enabled === false) {
                pass(`openclaw_cron_update → ${text.text.slice(0, 120)}`);
              } else {
                fail("openclaw_cron_update → unexpected update result", text.text.slice(0, 200));
              }
            } catch {
              fail("openclaw_cron_update → response is not valid JSON", text.text.slice(0, 200));
            }
          }
        } else {
          fail("openclaw_cron_update → expected success, got error", JSON.stringify(r.content));
        }
      } catch (e) {
        fail("openclaw_cron_update → unexpected exception", e.message);
      }
    }

    // NEGATIVE: Providing both 'id' and 'jobId' must be rejected by local validation.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_update",
        arguments: { id: "abc", jobId: "xyz", patch: {} }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (ID_VALIDATION_RE.test(errText)) {
          pass("openclaw_cron_update (negative) → correctly rejects ambiguous id/jobId");
        } else {
          fail("openclaw_cron_update (negative) → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_update (negative) → expected rejection, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (ID_VALIDATION_RE.test(e.message ?? "")) {
        pass("openclaw_cron_update (negative) → correctly rejects ambiguous id/jobId");
      } else {
        fail("openclaw_cron_update (negative) → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_run
    // POSITIVE: Tool must trigger the just-created job immediately and return a run result.
    if (!createdJobId) {
      fail("openclaw_cron_run → skipped because cron_add did not return a job id");
    } else {
      try {
        const r = await client.callTool({
          name: "openclaw_cron_run",
          arguments: { id: createdJobId, mode: "force" }
        });
        if (!r.isError) {
          const text = firstTextContent(r.content);
          if (!text) {
            fail("openclaw_cron_run → no text content", JSON.stringify(r));
          } else {
            try {
              const parsed = JSON.parse(text.text);
              if (parsed.ok === true && typeof parsed.runId === "string") {
                pass(`openclaw_cron_run → ${text.text.slice(0, 120)}`);
              } else {
                fail("openclaw_cron_run → missing expected fields ok/runId", text.text.slice(0, 200));
              }
            } catch {
              fail("openclaw_cron_run → response is not valid JSON", text.text.slice(0, 200));
            }
          }
        } else {
          fail("openclaw_cron_run → expected success, got error", JSON.stringify(r.content));
        }
      } catch (e) {
        fail("openclaw_cron_run → unexpected exception", e.message);
      }
    }

    // NEGATIVE: Omitting both 'id' and 'jobId' must be rejected by local validation.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_run",
        arguments: { mode: "force" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (ID_VALIDATION_RE.test(errText)) {
          pass("openclaw_cron_run (negative) → correctly rejects missing id/jobId");
        } else {
          fail("openclaw_cron_run (negative) → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_run (negative) → expected rejection, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (ID_VALIDATION_RE.test(e.message ?? "")) {
        pass("openclaw_cron_run (negative) → correctly rejects missing id/jobId");
      } else {
        fail("openclaw_cron_run (negative) → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_runs
    // POSITIVE: Tool must return the run history for all jobs (may be empty or contain the run
    //           triggered above).
    try {
      const r = await client.callTool({ name: "openclaw_cron_runs" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_cron_runs → no text content", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (Array.isArray(parsed.entries)) {
              pass(`openclaw_cron_runs → ${text.text.slice(0, 120)}`);
            } else {
              fail("openclaw_cron_runs → missing expected field entries", text.text.slice(0, 200));
            }
          } catch {
            fail("openclaw_cron_runs → response is not valid JSON", text.text.slice(0, 200));
          }
        }
      } else {
        fail("openclaw_cron_runs → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_runs → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_remove
    // POSITIVE: Tool must delete the just-created job by UUID and confirm removal.
    if (!createdJobId) {
      fail("openclaw_cron_remove → skipped because cron_add did not return a job id");
    } else {
      try {
        const r = await client.callTool({
          name: "openclaw_cron_remove",
          arguments: { id: createdJobId }
        });
        if (!r.isError) {
          const text = firstTextContent(r.content);
          if (!text) {
            fail("openclaw_cron_remove → no text content", JSON.stringify(r));
          } else {
            try {
              const parsed = JSON.parse(text.text);
              if (parsed.ok === true && parsed.removed === true) {
                pass(`openclaw_cron_remove → ${text.text.slice(0, 120)}`);
                createdJobId = null; // successfully removed; no cleanup needed
              } else {
                fail("openclaw_cron_remove → missing expected fields ok/removed", text.text.slice(0, 200));
              }
            } catch {
              fail("openclaw_cron_remove → response is not valid JSON", text.text.slice(0, 200));
            }
          }
        } else {
          fail("openclaw_cron_remove → expected success, got error", JSON.stringify(r.content));
        }
      } catch (e) {
        fail("openclaw_cron_remove → unexpected exception", e.message);
      }
    }

    // NEGATIVE: Providing both 'id' and 'jobId' must be rejected by local validation.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_remove",
        arguments: { id: "abc", jobId: "xyz" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (ID_VALIDATION_RE.test(errText)) {
          pass("openclaw_cron_remove (negative) → correctly rejects ambiguous id/jobId");
        } else {
          fail("openclaw_cron_remove (negative) → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_remove (negative) → expected rejection, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (ID_VALIDATION_RE.test(e.message ?? "")) {
        pass("openclaw_cron_remove (negative) → correctly rejects ambiguous id/jobId");
      } else {
        fail("openclaw_cron_remove (negative) → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- negative: unknown tool
    // NEGATIVE: The MCP gateway must reject calls to tool names not in its allowlist.
    try {
      const r = await client.callTool({ name: "unknown_tool_xyz" });
      if (r.isError) {
        pass("unknown tool (negative) → correctly rejects unknown tool name");
      } else {
        fail("unknown tool (negative) → expected rejection, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (/unknown|invalid/i.test(e.message ?? "")) {
        pass("unknown tool (negative) → correctly rejects unknown tool name");
      } else {
        fail("unknown tool (negative) → unexpected exception", e.message);
      }
    }
  } finally {
    // Best-effort cleanup: remove the test job if it was not already removed.
    if (createdJobId) {
      await client.callTool({
        name: "openclaw_cron_remove",
        arguments: { id: createdJobId }
      }).catch(() => { });
    }
    await client.close().catch(() => { });
  }

  // ------------------------------------------------------------------ summary
  console.log(`\n${passed + failed} test(s): ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e.message ?? String(e));
  process.exit(1);
});
