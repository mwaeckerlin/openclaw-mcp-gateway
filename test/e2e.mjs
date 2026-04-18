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
  console.log("Skipping E2E tests: OPENCLAW_E2E_MCP_URL is not set");
  process.exit(0);
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

    // ------------------------------------------------- openclaw_gateway_status
    // Calls GET /api/v1/check on the upstream gateway.
    // Accept: non-empty text response OR "not supported" capability error.
    try {
      const r = await client.callTool({ name: "openclaw_gateway_status" });
      const text = firstTextContent(r.content);
      if (text) {
        pass(`openclaw_gateway_status → ${text.text}`);
      } else if (r.isError && /not supported/i.test(JSON.stringify(r.content))) {
        pass(`openclaw_gateway_status → not supported by this gateway (acceptable): ${JSON.stringify(r.content)}`);
      } else {
        fail("openclaw_gateway_status → unexpected response", JSON.stringify(r));
      }
    } catch (e) {
      if (/not supported/i.test(e.message ?? "")) {
        pass(`openclaw_gateway_status → not supported by this gateway (acceptable): ${e.message}`);
      } else {
        fail("openclaw_gateway_status → unexpected error", e.message);
      }
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
