---
name: openclaw-mcp-gateway
description: Use this skill when operating or integrating the openclaw-mcp-gateway project: configuring MCP-to-Gateway auth, running health/tools checks, enabling cron RPC tools, and troubleshooting gateway transport/validation/auth errors for SSH-sandboxed agents.
---

# OpenClaw MCP Gateway

Use this skill to operate the `openclaw-mcp-gateway` service safely and effectively.

## What this project does

- Exposes a strict MCP allowlist for OpenClaw Gateway operations.
- Keeps gateway credentials outside SSH sandbox agents.
- Supports fixed HTTP tools and allowlisted Gateway WebSocket RPC cron tools.

## Setup Checklist

1. Set `OPENCLAW_GATEWAY_URL`.
2. Set `OPENCLAW_GATEWAY_TOKEN` (or legacy `OPENCLAW_GATEWAY_KEY`) or mount `/run/secret/openclaw_gateway_token`.
3. Start service (`npm start` or compose).
4. Verify `GET /healthz` returns `{ "ok": true, "status": "ready" }`.
5. Verify MCP `tools/list` contains:
   - `openclaw_status`
   - `openclaw_gateway_status`
   - `openclaw_cron_status`
   - `openclaw_cron_list`
   - `openclaw_cron_add`
   - `openclaw_cron_update`
   - `openclaw_cron_remove`
   - `openclaw_cron_run`
   - `openclaw_cron_runs`

## Cron RPC Usage Notes

- `openclaw_cron_run` may return `enqueued: true`; use `openclaw_cron_runs` to inspect final run outcome.
- Prefer local validation errors over trial-and-error upstream failures:
  - schedule kind/fields
  - `sessionTarget` (`main|isolated|current|session:<id>`)
  - `wakeMode` (`now|next-heartbeat`)
  - delivery/failureAlert structures

## Troubleshooting Map

- **Validation mismatch**: input schema rejected locally (fix args shape).
- **Gateway auth failure**: token invalid/missing.
- **Gateway transport timeout**: Gateway unreachable/stalled.
- **Gateway protocol failure**: malformed/non-ok RPC frame.
- **Not supported capability**: Gateway version lacks required cron method.

## Safe Operating Rules

- Never expose Gateway token to sandboxed agents.
- Use only allowlisted MCP tools; do not bypass with raw Gateway RPC.
- Keep per-tool usage scoped to required operation only.
