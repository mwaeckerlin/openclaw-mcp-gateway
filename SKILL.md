---
name: openclaw-mcp-gateway
description: Use this skill when you need to inspect or control an OpenClaw Gateway via MCP tools — checking gateway health, reading status/logs/config, managing cron jobs, or diagnosing failures. All tools are read-only except the cron management set.
---

# OpenClaw MCP Gateway

MCP gateway that exposes a strict allowlist of read-only and cron-management tools against an OpenClaw Gateway backend. Credentials stay outside SSH sandbox agents.

## First step

**Always call `openclaw_gateway_status` first.** If it returns `ok: false` or throws, the gateway is unreachable — stop and report the error. Do not call other tools until connectivity is confirmed.

## Tool selection guide

### Health and diagnostics

| Goal | Tool |
|---|---|
| Confirm gateway is reachable | `openclaw_gateway_status` |
| Full health snapshot | `openclaw_health` (add `verbose: true` for probe detail) |
| RPC layer reachability check | `openclaw_gateway_probe` |
| Read-only diagnostics (no repair) | `openclaw_doctor` (add `deep: true` for channel probes) |

### Status and usage

| Goal | Tool |
|---|---|
| Summary status | `openclaw_status` |
| Deep status including nodes | `openclaw_status` with `type: "deep"` |
| Usage/cost summary | `openclaw_status` with `type: "usage"` or `openclaw_gateway_usage_cost` |
| All status families at once | `openclaw_status` with `type: "all"` |
| Current system presence | `openclaw_system_presence` |

### Logs

| Goal | Tool |
|---|---|
| Recent gateway logs | `openclaw_logs` (bounded; `follow` is rejected) |
| Logs scoped to one channel | `openclaw_channels_logs` with `channel` |

### Channels and models

| Goal | Tool |
|---|---|
| Which channels are configured | `openclaw_channels_list` |
| Are channels reachable right now | `openclaw_channels_status` (add `probe: true`) |
| Which models are available | `openclaw_models_list` |
| Are model credentials valid | `openclaw_models_status` (add `probe: true` for live test) |
| Model aliases from config | `openclaw_models_aliases_list` |
| Model fallback chains from config | `openclaw_models_fallbacks_list` |

### Config inspection

| Goal | Tool |
|---|---|
| Read a specific config value | `openclaw_config_get` with required `path` (secret paths blocked) |
| Where is the active config file | `openclaw_config_file` |
| Is the config valid | `openclaw_config_validate` |
| Full config schema | `openclaw_config_schema` |

### Approvals, devices, and nodes

| Goal | Tool |
|---|---|
| Effective exec approvals | `openclaw_approvals_get` (`target`: `"local"` / `"gateway"` / `"node"`) |
| Paired and pending devices | `openclaw_devices_list` |
| Node list | `openclaw_nodes_list` (filter: `connectedOnly`, `lastConnected`) |
| Nodes awaiting pairing | `openclaw_nodes_pending` |
| Node status view | `openclaw_nodes_status` |

### Skills and sessions

| Goal | Tool |
|---|---|
| Are all skills ready | `openclaw_skills_check` |
| Browse skills | `openclaw_skills_list` (filter: `eligible`, `query`, paginate with `limit`/`offset`) |
| Detail for one skill | `openclaw_skills_detail` — requires one of `skillKey` or `name` |
| List active sessions | `openclaw_sessions_list` (filter: `kind`, `activeMinutes`) |
| Status of one session | `openclaw_session_status` — requires one of `sessionKey` or `sessionId` |

### Cron management

| Goal | Tool |
|---|---|
| Is the scheduler running | `openclaw_cron_status` |
| List jobs | `openclaw_cron_list` |
| Create a job | `openclaw_cron_add` — see [Cron job reference](#cron-job-reference) |
| Modify a job | `openclaw_cron_update` — requires one of `id` or `jobId`, plus `patch` |
| Delete a job | `openclaw_cron_remove` — requires one of `id` or `jobId` |
| Trigger a job now | `openclaw_cron_run` — **always follow up with `openclaw_cron_runs`**; the tool may only enqueue |
| Check run history or outcome | `openclaw_cron_runs` |

## Available tools

| MCP Tool | What it does |
|---|---|
| `openclaw_gateway_status` | Curated health fields from the gateway HTTP health endpoint |
| `openclaw_health` | Full gateway health snapshot with optional probe detail |
| `openclaw_status` | Status family summary (`default` / `deep` / `usage` / `all`) |
| `openclaw_logs` | Bounded log tail with secret redaction |
| `openclaw_gateway_probe` | Gateway and RPC reachability diagnostics |
| `openclaw_gateway_usage_cost` | Usage cost summaries from session logs |
| `openclaw_doctor` | Read-only diagnostics; no repair actions |
| `openclaw_system_presence` | Current system presence entries |
| `openclaw_channels_list` | Configured channel accounts |
| `openclaw_channels_status` | Channel runtime status with optional live probes |
| `openclaw_channels_logs` | Bounded channel log tail with redaction |
| `openclaw_models_status` | Model/provider auth status with optional live probes |
| `openclaw_models_list` | Available models for an agent workspace |
| `openclaw_models_aliases_list` | Model aliases from active config |
| `openclaw_models_fallbacks_list` | Model fallback chains from active config |
| `openclaw_config_get` | Read one config path (secret-bearing paths blocked) |
| `openclaw_config_file` | Active config file path |
| `openclaw_config_validate` | Config validation result |
| `openclaw_config_schema` | Full config JSON schema |
| `openclaw_approvals_get` | Effective exec approvals snapshot |
| `openclaw_devices_list` | Pending and paired devices (tokens redacted) |
| `openclaw_nodes_list` | Node list with optional filters |
| `openclaw_nodes_pending` | Nodes awaiting pairing |
| `openclaw_nodes_status` | Node status view with optional filters |
| `openclaw_skills_check` | Skill readiness summary |
| `openclaw_sessions_list` | Read-only session list with paging |
| `openclaw_session_status` | Read-only status for one session |
| `openclaw_skills_list` | Skill inventory with filtering and paging |
| `openclaw_skills_detail` | Detail for one skill by key or name |
| `openclaw_cron_status` | Cron scheduler status |
| `openclaw_cron_list` | List cron jobs with paging, filter, and sort |
| `openclaw_cron_add` | Create a cron job |
| `openclaw_cron_update` | Patch an existing cron job |
| `openclaw_cron_remove` | Remove a cron job |
| `openclaw_cron_run` | Trigger a job on demand (may only enqueue) |
| `openclaw_cron_runs` | Inspect run outcomes and history |

## Cron job reference

Use this when building arguments for `openclaw_cron_add` or `openclaw_cron_update`.

### schedule (required on add)

Pick one `kind`:

```jsonc
{ "kind": "at",    "at": "2026-06-01T10:00:00+00:00" }
{ "kind": "every", "everyMs": 3600000 }
{ "kind": "cron",  "expr": "0 9 * * 1-5", "tz": "Europe/Berlin" }
```

`cron` also accepts `staggerMs` (random jitter); `every` accepts `anchorMs`.

### payload (required on add)

Pick one `kind`:

```jsonc
{ "kind": "systemEvent", "text": "run nightly check" }
{ "kind": "agentTurn",   "message": "perform nightly analysis", "model": "gpt-4o",
  "fallbacks": ["gpt-4"], "timeoutSeconds": 300 }
```

`agentTurn` optional fields: `thinking`, `lightContext`, `toolsAllow`, `allowUnsafeExternalContent`.

### delivery (optional)

```jsonc
{ "mode": "none" }
{ "mode": "announce", "channel": "last" }
{ "mode": "webhook",  "to": "https://hooks.example.com/notify" }
```

Add `bestEffort: true` to avoid failing the job on delivery error. Use `failureDestination` for an alternate target on job failure.

### failureAlert (optional)

```jsonc
false
{ "after": 3, "channel": "last", "cooldownMs": 3600000 }
```

### state patch (openclaw_cron_update only)

Pass `patch.state` to manually correct runtime state fields: `nextRunAtMs`, `lastRunAtMs`, `lastRunStatus`, `consecutiveErrors`, `lastDeliveryStatus`, etc.

---

## Troubleshooting

| Error contains | Cause | Action |
|---|---|---|
| `Validation mismatch` | Input schema rejected before RPC | Fix argument shape |
| `Gateway auth failure` | Token invalid or missing | Check `OPENCLAW_GATEWAY_TOKEN` |
| `Gateway transport timeout` | Gateway unreachable or stalled | Check `OPENCLAW_GATEWAY_URL` |
| `Gateway protocol failure` | Bad RPC frame or device not paired | Check Gateway version; verify device pairing |
| `not supported by the current Gateway` | Gateway lacks the required RPC method | Upgrade Gateway |

## Safe operating rules

- All non-cron tools are read-only.
- `openclaw_config_get` blocks secret-bearing paths; do not attempt to work around this.
- `openclaw_cron_run` may return `enqueued: true` — always follow up with `openclaw_cron_runs` to confirm the outcome.
- Do not bypass these tools with raw HTTP calls to the OpenClaw gateway.
