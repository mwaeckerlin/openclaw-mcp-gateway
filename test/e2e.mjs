/**
 * End-to-end test for the OpenClaw MCP Gateway.
 *
 * Connects to the MCP HTTP endpoint, exercises every exposed tool, and
 * validates negative cases. Exits with code 0 on success, 1 on failure.
 * No test framework — just plain Node.js with the MCP SDK client.
 *
 * Required environment variable:
 *   OPENCLAW_E2E_MCP_URL  Full URL of the MCP gateway endpoint, e.g. http://mcp-gateway:4000
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.OPENCLAW_E2E_MCP_URL;
if (!MCP_URL) {
  console.error("OPENCLAW_E2E_MCP_URL is not set — run E2E tests via: cd test && docker compose up");
  process.exit(1);
}

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

  // ------------------------------------------------------------------ healthz
  await waitForHealthz(MCP_URL);
  pass("/healthz → 200 ok");

  // --------------------------------------------------------- connect MCP client
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client({ name: "e2e-test", version: "1.0.0" });
  await client.connect(transport);

  try {
    // --------------------------------------------------------------- tools/list
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    if (toolNames.includes("openclaw_status")) {
      pass("tools/list → openclaw_status is present");
    } else {
      fail("tools/list → openclaw_status missing", `got: [${toolNames.join(", ")}]`);
    }

    if (toolNames.includes("openclaw_gateway_status")) {
      pass("tools/list → openclaw_gateway_status is present");
    } else {
      fail("tools/list → openclaw_gateway_status missing", `got: [${toolNames.join(", ")}]`);
    }

    const requiredCronTools = [
      "openclaw_cron_status",
      "openclaw_cron_list",
      "openclaw_cron_add",
      "openclaw_cron_update",
      "openclaw_cron_remove",
      "openclaw_cron_run",
      "openclaw_cron_runs"
    ];
    for (const tool of requiredCronTools) {
      if (toolNames.includes(tool)) {
        pass(`tools/list → ${tool} is present`);
      } else {
        fail(`tools/list → ${tool} missing`, `got: [${toolNames.join(", ")}]`);
      }
    }

    // ------------------------------------------------- openclaw_gateway_status
    // Calls GET /api/v1/check on the upstream gateway.
    // Must return non-empty text response.
    try {
      const r = await client.callTool({ name: "openclaw_gateway_status" });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_gateway_status → ${text.text}`);
      } else {
        fail("openclaw_gateway_status → unexpected response", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_gateway_status → unexpected error", e.message);
    }

    // ------------------------------------------------------- openclaw_status
    // Calls POST /tools/invoke on the upstream gateway.
    // Accept: non-empty text response OR a gateway-level error response
    // (the MCP layer must still respond with valid MCP content).
    try {
      const r = await client.callTool({ name: "openclaw_status" });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_status → ${text.text}`);
      } else if (r.isError) {
        // Gateway returned an error, but the MCP layer handled it correctly.
        pass(`openclaw_status → gateway returned error, MCP layer handled it correctly: ${JSON.stringify(r.content)}`);
      } else {
        fail("openclaw_status → unexpected response", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_status → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_status
    // Calls cron.status via WebSocket RPC on the upstream gateway.
    // Accept: successful JSON response OR a capability/auth error (cron RPC not enabled).
    try {
      const r = await client.callTool({ name: "openclaw_cron_status" });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_cron_status → success: ${text.text.slice(0, 120)}`);
      } else if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/not supported|capability|auth/i.test(errText)) {
          pass(`openclaw_cron_status → expected capability/auth error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_status → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_status → no text content", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_cron_status → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_list
    // Calls cron.list via WebSocket RPC on the upstream gateway.
    // Accept: job list response OR capability/auth error.
    try {
      const r = await client.callTool({ name: "openclaw_cron_list" });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_cron_list → success: ${text.text.slice(0, 120)}`);
      } else if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/not supported|capability|auth/i.test(errText)) {
          pass(`openclaw_cron_list → expected capability/auth error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_list → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_list → no text content", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_cron_list → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_add (valid gateway call)
    // Submit a complete valid cron job to the gateway.
    // Accept: success (job created) OR capability/auth error from gateway.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_add",
        arguments: {
          name: "e2e-test-job",
          schedule: { kind: "cron", expr: "0 3 * * *" },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          payload: { kind: "systemEvent", text: "e2e test run" }
        }
      });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_cron_add → success: ${text.text.slice(0, 120)}`);
      } else if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/not supported|capability|auth/i.test(errText)) {
          pass(`openclaw_cron_add → expected capability/auth error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_add → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_add → no text content", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_cron_add → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_add validation error
    // Missing required fields (schedule, sessionTarget, wakeMode, payload) must produce
    // a local validation error before any gateway call is made.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_add",
        arguments: { name: "bad-job" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/validation|mismatch|required|invalid/i.test(errText)) {
          pass(`openclaw_cron_add validation → got expected error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_add validation → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_add validation → expected validation error, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (/validation|mismatch|required|invalid/i.test(e.message ?? "")) {
        pass(`openclaw_cron_add validation → throws expected error: ${e.message}`);
      } else {
        fail("openclaw_cron_add validation → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_update (valid gateway call)
    // Patch a job by a placeholder jobId.
    // Accept: success OR any gateway error (not found, capability, auth).
    try {
      const r = await client.callTool({
        name: "openclaw_cron_update",
        arguments: {
          jobId: "e2e-test-job",
          patch: { enabled: false }
        }
      });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_cron_update → success: ${text.text.slice(0, 120)}`);
      } else if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/not supported|capability|auth|not found|unknown/i.test(errText)) {
          pass(`openclaw_cron_update → expected gateway error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_update → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_update → no text content", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_cron_update → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_update with bad args
    // Providing both id and jobId must fail validation locally.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_update",
        arguments: { id: "abc", jobId: "xyz", patch: {} }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/validation|mismatch|id|jobId/i.test(errText)) {
          pass(`openclaw_cron_update validation → got expected error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_update validation → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_update validation → expected validation error, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (/validation|mismatch|id|jobId/i.test(e.message ?? "")) {
        pass(`openclaw_cron_update validation → throws expected error: ${e.message}`);
      } else {
        fail("openclaw_cron_update validation → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_remove (valid gateway call)
    // Remove a job by a placeholder jobId.
    // Accept: success OR any gateway error (not found, capability, auth).
    try {
      const r = await client.callTool({
        name: "openclaw_cron_remove",
        arguments: { jobId: "e2e-test-job" }
      });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_cron_remove → success: ${text.text.slice(0, 120)}`);
      } else if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/not supported|capability|auth|not found|unknown/i.test(errText)) {
          pass(`openclaw_cron_remove → expected gateway error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_remove → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_remove → no text content", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_cron_remove → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_remove with bad args
    // Providing both id and jobId must fail validation locally.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_remove",
        arguments: { id: "abc", jobId: "xyz" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/validation|mismatch|id|jobId/i.test(errText)) {
          pass(`openclaw_cron_remove validation → got expected error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_remove validation → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_remove validation → expected validation error, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (/validation|mismatch|id|jobId/i.test(e.message ?? "")) {
        pass(`openclaw_cron_remove validation → throws expected error: ${e.message}`);
      } else {
        fail("openclaw_cron_remove validation → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_run (valid gateway call)
    // Trigger a job by a placeholder jobId.
    // Accept: success OR any gateway error (not found, capability, auth).
    try {
      const r = await client.callTool({
        name: "openclaw_cron_run",
        arguments: { jobId: "e2e-test-job", mode: "force" }
      });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_cron_run → success: ${text.text.slice(0, 120)}`);
      } else if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/not supported|capability|auth|not found|unknown/i.test(errText)) {
          pass(`openclaw_cron_run → expected gateway error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_run → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_run → no text content", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_cron_run → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_run with bad args
    // Providing neither id nor jobId must fail validation locally.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_run",
        arguments: { mode: "force" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/validation|mismatch|id|jobId/i.test(errText)) {
          pass(`openclaw_cron_run validation → got expected error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_run validation → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_run validation → expected validation error, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (/validation|mismatch|id|jobId/i.test(e.message ?? "")) {
        pass(`openclaw_cron_run validation → throws expected error: ${e.message}`);
      } else {
        fail("openclaw_cron_run validation → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_runs
    // Calls cron.runs via WebSocket RPC on the upstream gateway.
    // Accept: successful run history response OR capability/auth error.
    try {
      const r = await client.callTool({ name: "openclaw_cron_runs" });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_cron_runs → success: ${text.text.slice(0, 120)}`);
      } else if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (/not supported|capability|auth/i.test(errText)) {
          pass(`openclaw_cron_runs → expected capability/auth error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_runs → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_runs → no text content", JSON.stringify(r));
      }
    } catch (e) {
      fail("openclaw_cron_runs → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: unknown tool
    // The MCP gateway must reject calls to tools not in its allowlist.
    try {
      const r = await client.callTool({ name: "unknown_tool_xyz" });
      if (r.isError || /unknown|error|invalid/i.test(JSON.stringify(r))) {
        pass(`unknown tool → got expected error response: ${JSON.stringify(r.content)}`);
      } else {
        fail("unknown tool → expected error response", JSON.stringify(r));
      }
    } catch (e) {
      if (/unknown|error|invalid/i.test(e.message ?? "")) {
        pass(`unknown tool → throws expected error: ${e.message}`);
      } else {
        fail("unknown tool → unexpected exception", e.message);
      }
    }
  } finally {
    await client.close().catch(() => {});
  }

  // ------------------------------------------------------------------ summary
  console.log(`\n${passed + failed} test(s): ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e.message ?? String(e));
  process.exit(1);
});
