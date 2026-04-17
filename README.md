# OpenClaw MCP Gateway

MCP server to give SSH-sandboxed AI agents limited access to the OpenClaw CLI.

## Why this exists

This project is a small standalone Model Context Protocol (MCP) server. It exposes only a tiny set of OpenClaw operational commands to an AI agent, with strict guardrails.

It is **not** an OpenClaw plugin. It runs as its own process and communicates over MCP stdio.

## Security model

This server is allowlist-only:

- No arbitrary shell execution
- No arbitrary OpenClaw command execution
- No arbitrary argument forwarding from MCP clients
- No shell invocation (`execFile` is used directly)

Each MCP tool maps to one fixed internal command with a fixed timeout.

## Supported MCP tools

- `openclaw_status` → `openclaw status`
- `openclaw_gateway_status` → `openclaw gateway status`
- `openclaw_logs` → `openclaw logs --tail 200`

## Prerequisites

- Node.js 22+ (or compatible modern Node.js runtime)
- npm
- `openclaw` CLI available in `PATH` on the host where this server runs

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
npm start
```

The server communicates over stdio. Startup and operational logs are written to `stderr` only.

## Run in Docker

```bash
docker build -t openclaw-mcp-gateway:local .
```

```bash
docker run --rm -it openclaw-mcp-gateway:local
```

> Note: the container must have access to the `openclaw` binary to execute commands successfully.

## Run with docker-compose

```bash
docker compose up --build
```

## MCP client configuration example (stdio)

Example configuration (shape may vary by client):

```json
{
  "mcpServers": {
    "openclaw-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/openclaw-mcp-gateway/dist/server.js"]
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
      "args": ["tsx", "/absolute/path/to/openclaw-mcp-gateway/src/server.ts"]
    }
  }
}
```

## Limitations

- Only three fixed tools are available
- Tool inputs are intentionally empty in this first version
- No streaming, pagination, or advanced filtering for logs
- Requires local OpenClaw CLI presence and permissions

## Future extension ideas

- Add more allowlisted tools (still fixed and explicit)
- Add structured parsing for status outputs
- Add configurable but bounded log tail values
- Add metrics/health integration for deployment environments
