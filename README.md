# OpenClaw MCP Gateway

MCP server to give SSH-sandboxed AI agents limited access to OpenClaw Gateway operations.

## Why this exists

This project is a small standalone Model Context Protocol (MCP) server. It exposes only a tiny set of OpenClaw operational actions to an AI agent, with strict guardrails.

It is **not** an OpenClaw plugin. It runs as its own process, communicates over MCP stdio, and talks to OpenClaw Gateway over HTTP.

## Security model

This server is allowlist-only:

- No arbitrary shell execution
- No arbitrary command execution
- No arbitrary argument forwarding from MCP clients
- No dynamic endpoint selection from MCP input

Each MCP tool maps to one fixed, documented Gateway request with a fixed timeout.

## Supported MCP tools

The MCP tools are fixed and route-mapped as follows:

- `openclaw_status` → `POST /tools/invoke` (payload via env mapping)
- `openclaw_gateway_status` → `GET /api/v1/check`
- `openclaw_logs` → `POST /tools/invoke` (payload via env mapping)

To avoid inventing Gateway tool names in code, `/tools/invoke` tools are mapped through explicit environment variables containing the exact JSON payload.

If the mapping is missing, or Gateway returns capability errors (for example endpoint/tool not supported or not allowlisted), the MCP tool returns a clear `not supported by the current Gateway API` error.

## Prerequisites

- Node.js 22+ (or compatible modern Node.js runtime)
- npm
- Network access from this service to the OpenClaw Gateway
- OpenClaw Gateway API token

## Required environment variables

Gateway connection/auth:

- `OPENCLAW_GATEWAY_URL` (required): Base URL for the Gateway API (http/https)
- `OPENCLAW_GATEWAY_TOKEN` (preferred, optional if file/legacy key is used): Bearer token
- `OPENCLAW_GATEWAY_TOKEN_FILE` (optional): absolute path to a file containing the token
- `OPENCLAW_GATEWAY_KEY` / `OPENCLAW_GATEWAY_KEY_FILE` (legacy compatibility aliases)

Set one of: `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_GATEWAY_TOKEN_FILE`, `OPENCLAW_GATEWAY_KEY`, or `OPENCLAW_GATEWAY_KEY_FILE`.

Tool payload mappings (optional, but required per tool you want enabled):

- `OPENCLAW_STATUS_PAYLOAD_JSON` for `openclaw_status`
- `OPENCLAW_LOGS_PAYLOAD_JSON` for `openclaw_logs`

Each payload variable must be a valid JSON object matching the documented `/tools/invoke` body shape:

- `tool` (required)
- `action` (optional)
- `args` (optional object)
- `sessionKey` (optional)
- `dryRun` (optional)

Verified `/tools/invoke` example from OpenClaw docs/source:

```json
{"tool":"sessions_list","action":"json","args":{}}
```

Example mapping (MCP tool → env var):

- `openclaw_status` → `OPENCLAW_STATUS_PAYLOAD_JSON`
- `openclaw_logs` → `OPENCLAW_LOGS_PAYLOAD_JSON`

Use only tool names that are verified in OpenClaw docs/source and allowlisted in your Gateway policy.

The payload values in runtime examples below are **schema placeholders** only; replace them with your own verified tool/action/args combination from OpenClaw docs/source and your Gateway allowlist.

## Local development setup

```bash
npm install
```

## Build

```bash
npm run build
```

## Run locally

```bash
OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789" \
OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
OPENCLAW_STATUS_PAYLOAD_JSON='{"tool":"<verified-status-tool>","action":"<optional-action>","args":{}}' \
OPENCLAW_LOGS_PAYLOAD_JSON='{"tool":"<verified-logs-tool>","action":"<optional-action>","args":{}}' \
npm start
```

The server communicates over stdio. Startup and operational logs are written to `stderr` only.

## Run in Docker

```bash
docker build -t openclaw-mcp-gateway:local .
```

```bash
docker run --rm -it \
  -e OPENCLAW_GATEWAY_URL="http://gateway.example.local:18789" \
  -e OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
  -e OPENCLAW_STATUS_PAYLOAD_JSON='{"tool":"<verified-status-tool>","action":"<optional-action>","args":{}}' \
  openclaw-mcp-gateway:local
```

## Run with docker-compose

```bash
OPENCLAW_GATEWAY_URL="http://gateway.example.local:18789" \
OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
OPENCLAW_STATUS_PAYLOAD_JSON='{"tool":"<verified-status-tool>","action":"<optional-action>","args":{}}' \
docker compose up --build
```

## Run E2E tests from `test/` directory

The repository includes a dedicated `test/docker-compose.yml` for E2E execution.

From `test/`, `docker compose up` starts `mwaeckerlin/openclaw:gateway` and runs `npm run test` in a separate `e2e` container against that live Gateway.

```bash
cd test
docker compose up --abort-on-container-exit --exit-code-from e2e
```

Optional overrides:

- `OPENCLAW_E2E_GATEWAY_TOKEN` (default: `test-gateway-token`)
- `OPENCLAW_E2E_OPENAI_API_KEY` (default: `test-openai-key`)
- `OPENCLAW_E2E_SANDBOX_SSH_PRIVATE_KEY` (default: `test-sandbox-key`)
- `OPENCLAW_E2E_STATUS_PAYLOAD_JSON` (default from test file: `{"tool":"sessions_list","action":"json","args":{}}`)

## MCP client configuration example (stdio)

```json
{
  "mcpServers": {
    "openclaw-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/openclaw-mcp-gateway/dist/server.js"],
        "env": {
          "OPENCLAW_GATEWAY_URL": "http://127.0.0.1:18789",
          "OPENCLAW_GATEWAY_TOKEN": "your-gateway-token",
          "OPENCLAW_STATUS_PAYLOAD_JSON": "{\"tool\":\"<verified-status-tool>\",\"action\":\"<optional-action>\",\"args\":{}}"
        }
      }
    }
  }
```

## Limitations

- Only three fixed MCP tools are available
- Tool inputs are intentionally empty in this version
- `/tools/invoke` tools require explicit payload mapping env vars; unmapped tools return not-supported
- Behavior depends on what the current Gateway policy allowlists for `/tools/invoke`

## Documentation references used

- OpenClaw Gateway Tools Invoke API:
  https://github.com/openclaw/openclaw/blob/main/docs/gateway/tools-invoke-http-api.md
- OpenClaw `/api/v1/check` reference:
  https://github.com/openclaw/openclaw/blob/main/docs/reference/rpc.md
- OpenClaw `/tools/invoke` handler source:
  https://github.com/openclaw/openclaw/blob/main/src/gateway/tools-invoke-http.ts

## Future extension ideas

- Add startup capability probes for mapped tools
- Add more allowlisted tools (still fixed and explicit)
- Add richer structured parsing of invoke results
