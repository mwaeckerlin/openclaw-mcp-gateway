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

Each MCP tool maps to one fixed Gateway **`POST /tools/invoke`** request with a fixed timeout.

## Supported MCP tools

The MCP tools are fixed:

- `openclaw_status`
- `openclaw_gateway_status`
- `openclaw_logs`

To avoid inventing Gateway tool names or payload schemas, each tool is mapped through an explicit environment variable that contains the exact `POST /tools/invoke` payload JSON.

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
- `OPENCLAW_GATEWAY_STATUS_PAYLOAD_JSON` for `openclaw_gateway_status`
- `OPENCLAW_LOGS_PAYLOAD_JSON` for `openclaw_logs`

Each payload variable must be valid JSON object for Gateway `/tools/invoke`, e.g.:

```json
{"tool":"status","arguments":{}}
```

Example mapping (MCP tool → env var → Gateway payload):

- `openclaw_status` → `OPENCLAW_STATUS_PAYLOAD_JSON` → `{"tool":"status","arguments":{}}`
- `openclaw_gateway_status` → `OPENCLAW_GATEWAY_STATUS_PAYLOAD_JSON` → `{"tool":"gateway_status","arguments":{}}`
- `openclaw_logs` → `OPENCLAW_LOGS_PAYLOAD_JSON` → `{"tool":"logs","arguments":{"tail":200}}`

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
OPENCLAW_STATUS_PAYLOAD_JSON='{"tool":"status","arguments":{}}' \
OPENCLAW_GATEWAY_STATUS_PAYLOAD_JSON='{"tool":"gateway_status","arguments":{}}' \
OPENCLAW_LOGS_PAYLOAD_JSON='{"tool":"logs","arguments":{"tail":200}}' \
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
  -e OPENCLAW_STATUS_PAYLOAD_JSON='{"tool":"status","arguments":{}}' \
  openclaw-mcp-gateway:local
```

## Run with docker-compose

```bash
OPENCLAW_GATEWAY_URL="http://gateway.example.local:18789" \
OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
OPENCLAW_STATUS_PAYLOAD_JSON='{"tool":"status","arguments":{}}' \
docker compose up --build
```

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
        "OPENCLAW_STATUS_PAYLOAD_JSON": "{\"tool\":\"status\",\"arguments\":{}}"
      }
    }
  }
}
```

## Limitations

- Only three fixed MCP tools are available
- Tool inputs are intentionally empty in this version
- Each tool needs an explicit payload mapping env var; unmapped tools return not-supported
- Behavior depends on what the current Gateway policy allowlists for `/tools/invoke`

## Future extension ideas

- Add startup capability probes for mapped tools
- Add more allowlisted tools (still fixed and explicit)
- Add richer structured parsing of invoke results
