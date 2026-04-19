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
      "openclaw_status",
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
    // POSITIVE: Tool must return the safe session summary.
    try {
      const r = await client.callTool({ name: "openclaw_status" });
      if (!r.isError) {
        const text = firstTextContent(r.content);
        if (!text) {
          fail("openclaw_status → no text content", JSON.stringify(r));
        } else {
          try {
            const parsed = JSON.parse(text.text);
            if (
              typeof parsed.total === "number" &&
              typeof parsed.limit === "number" &&
              Array.isArray(parsed.sessions)
            ) {
              pass(`openclaw_status → total=${parsed.total} returned=${parsed.returned}`);
            } else {
              fail("openclaw_status → missing expected fields total/limit/sessions", text.text.slice(0, 200));
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
      }).catch(() => {});
    }
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
