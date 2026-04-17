# OpenClaw MCP Gateway

MCP server to give SSH-sandboxed AI agents limited access to OpenClaw Gateway API operations.

## Why this exists

This project is a small standalone Model Context Protocol (MCP) server. It exposes only a tiny set of OpenClaw operational actions to an AI agent, with strict guardrails.

It is **not** an OpenClaw plugin. It runs as its own process, communicates over MCP stdio, and talks to OpenClaw Gateway over HTTP.

## Security model

This server is allowlist-only:

- No arbitrary shell execution
- No arbitrary command execution
- No arbitrary argument forwarding from MCP clients
- No dynamic endpoint selection from MCP input

Each MCP tool maps to one fixed Gateway HTTP request with a fixed timeout.

## Supported MCP tools

- `openclaw_status` → `GET /api/v1/status`
- `openclaw_gateway_status` → `GET /api/v1/gateway/status`
- `openclaw_logs` → `GET /api/v1/logs?tail=200`

If `openclaw_logs` receives HTTP 404 from the Gateway API, the tool returns a clear not-supported error (`openclaw_logs is not supported by the current Gateway API`).

## Prerequisites

- Node.js 22+ (or compatible modern Node.js runtime)
- npm
- Network access from this service to the OpenClaw Gateway
- OpenClaw Gateway API credentials

## Required environment variables

- `OPENCLAW_GATEWAY_URL` (required): Base URL for the Gateway API (http/https)
- `OPENCLAW_GATEWAY_KEY` (optional if file is used): API key/token
- `OPENCLAW_GATEWAY_KEY_FILE` (optional): absolute path to a file containing the API key/token (useful for Docker/Kubernetes secrets)

Set either `OPENCLAW_GATEWAY_KEY` **or** `OPENCLAW_GATEWAY_KEY_FILE`.

## Local development setup

```bash
npm install
```

## Build

```bash
npm run build
```

## Run locally

Using direct key environment variable:

```bash
OPENCLAW_GATEWAY_URL="https://gateway.example.com" \
OPENCLAW_GATEWAY_KEY="your-api-key" \
npm start
```

Using key file:

```bash
OPENCLAW_GATEWAY_URL="https://gateway.example.com" \
OPENCLAW_GATEWAY_KEY_FILE="/run/secrets/openclaw_gateway_key" \
npm start
```

The server communicates over stdio. Startup and operational logs are written to `stderr` only.

## Run in Docker

```bash
docker build -t openclaw-mcp-gateway:local .
```

```bash
docker run --rm -it \
  -e OPENCLAW_GATEWAY_URL="https://gateway.example.com" \
  -e OPENCLAW_GATEWAY_KEY="your-api-key" \
  openclaw-mcp-gateway:local
```

Example with secret file mounted into container:

```bash
docker run --rm -it \
  -e OPENCLAW_GATEWAY_URL="https://gateway.example.com" \
  -e OPENCLAW_GATEWAY_KEY_FILE="/run/secrets/openclaw_gateway_key" \
  -v /host/path/openclaw_gateway_key:/run/secrets/openclaw_gateway_key:ro \
  openclaw-mcp-gateway:local
```

## Run with docker-compose

```bash
OPENCLAW_GATEWAY_URL="https://gateway.example.com" \
OPENCLAW_GATEWAY_KEY="your-api-key" \
docker compose up --build
```

## MCP client configuration example (stdio)

Example configuration (shape may vary by client):

```json
{
  "mcpServers": {
    "openclaw-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/openclaw-mcp-gateway/dist/server.js"],
      "env": {
        "OPENCLAW_GATEWAY_URL": "https://gateway.example.com",
        "OPENCLAW_GATEWAY_KEY": "your-api-key"
      }
    }
  }
}
```

For development, you can also point to tsx:

```json
{
  "mcpServers": {
    "openclaw-gateway": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/openclaw-mcp-gateway/src/server.ts"],
      "env": {
        "OPENCLAW_GATEWAY_URL": "https://gateway.example.com",
        "OPENCLAW_GATEWAY_KEY": "your-api-key"
      }
    }
  }
}
```

## Limitations

- Only three fixed tools are available
- Tool inputs are intentionally empty in this first version
- The server depends on currently available Gateway API endpoints
- No streaming, pagination, or advanced filtering beyond fixed `tail=200`

## Future extension ideas

- Add more allowlisted tools (still fixed and explicit)
- Add structured parsing for status responses
- Add configurable but bounded log tail values if Gateway supports it
- Add metrics/health integration for deployment environments
