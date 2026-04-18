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
    // Must succeed and return non-empty text response.
    try {
      const r = await client.callTool({ name: "openclaw_status" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          pass(`openclaw_status → ${text.text}`);
        } else {
          fail("openclaw_status → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_status → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_status → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_status
    // Calls cron.status via WebSocket RPC. Must succeed and return actual status data.
    try {
      const r = await client.callTool({ name: "openclaw_cron_status" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          pass(`openclaw_cron_status → ${text.text.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_status → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_status → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_status → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_list
    // Calls cron.list via WebSocket RPC. Must succeed and return a list (may be empty).
    try {
      const r = await client.callTool({ name: "openclaw_cron_list" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          pass(`openclaw_cron_list → ${text.text.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_list → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_list → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_list → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_add
    // Creates an E2E test cron job. Must succeed.
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
          pass(`openclaw_cron_add → ${text.text.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_add → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_add → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_add → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_add missing required fields
    // schedule, sessionTarget, wakeMode, payload are all required; omitting them must produce
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

    // ----------------------------------------------- openclaw_cron_update
    // Patches the E2E test job. Must succeed.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_update",
        arguments: {
          jobId: E2E_JOB_NAME,
          patch: { enabled: false }
        }
      });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          pass(`openclaw_cron_update → ${text.text.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_update → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_update → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_update → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_update both id and jobId
    // Providing both id and jobId must fail validation locally (exactly one required).
    try {
      const r = await client.callTool({
        name: "openclaw_cron_update",
        arguments: { id: "abc", jobId: "xyz", patch: {} }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (ID_VALIDATION_RE.test(errText)) {
          pass(`openclaw_cron_update validation → got expected error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_update validation → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_update validation → expected validation error, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (ID_VALIDATION_RE.test(e.message ?? "")) {
        pass(`openclaw_cron_update validation → throws expected error: ${e.message}`);
      } else {
        fail("openclaw_cron_update validation → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_run
    // Triggers the E2E test job immediately. Must succeed (response may contain enqueued: true).
    try {
      const r = await client.callTool({
        name: "openclaw_cron_run",
        arguments: { jobId: E2E_JOB_NAME, mode: "force" }
      });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          pass(`openclaw_cron_run → ${text.text.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_run → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_run → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_run → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_run neither id nor jobId
    // Omitting both id and jobId must fail validation locally (exactly one required).
    try {
      const r = await client.callTool({
        name: "openclaw_cron_run",
        arguments: { mode: "force" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (ID_VALIDATION_RE.test(errText)) {
          pass(`openclaw_cron_run validation → got expected error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_run validation → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_run validation → expected validation error, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (ID_VALIDATION_RE.test(e.message ?? "")) {
        pass(`openclaw_cron_run validation → throws expected error: ${e.message}`);
      } else {
        fail("openclaw_cron_run validation → unexpected exception", e.message);
      }
    }

    // ----------------------------------------------- openclaw_cron_runs
    // Calls cron.runs via WebSocket RPC. Must succeed and return run history.
    try {
      const r = await client.callTool({ name: "openclaw_cron_runs" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          pass(`openclaw_cron_runs → ${text.text.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_runs → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_runs → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_runs → unexpected exception", e.message);
    }

    // ----------------------------------------------- openclaw_cron_remove
    // Removes the E2E test job. Must succeed.
    try {
      const r = await client.callTool({
        name: "openclaw_cron_remove",
        arguments: { jobId: E2E_JOB_NAME }
      });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (text) {
          pass(`openclaw_cron_remove → ${text.text.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_remove → no text content", JSON.stringify(r));
        }
      } else {
        fail("openclaw_cron_remove → expected success, got error", JSON.stringify(r.content));
      }
    } catch (e) {
      fail("openclaw_cron_remove → unexpected exception", e.message);
    }

    // ----------------------------------------------- negative: cron_remove both id and jobId
    // Providing both id and jobId must fail validation locally (exactly one required).
    try {
      const r = await client.callTool({
        name: "openclaw_cron_remove",
        arguments: { id: "abc", jobId: "xyz" }
      });
      if (r.isError) {
        const errText = JSON.stringify(r.content);
        if (ID_VALIDATION_RE.test(errText)) {
          pass(`openclaw_cron_remove validation → got expected error: ${errText.slice(0, 120)}`);
        } else {
          fail("openclaw_cron_remove validation → unexpected error body", errText);
        }
      } else {
        fail("openclaw_cron_remove validation → expected validation error, got success", JSON.stringify(r));
      }
    } catch (e) {
      if (ID_VALIDATION_RE.test(e.message ?? "")) {
        pass(`openclaw_cron_remove validation → throws expected error: ${e.message}`);
      } else {
        fail("openclaw_cron_remove validation → unexpected exception", e.message);
      }
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
