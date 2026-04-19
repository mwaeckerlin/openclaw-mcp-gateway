import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { GatewayConfig } from "./commands.js";
import { callGatewayRpc, DeviceIdentity, GatewayRpcError } from "./gateway-rpc.js";

type JsonObject = Record<string, unknown>;

export type ReadonlyRpcToolName =
  | "openclaw_health"
  | "openclaw_status"
  | "openclaw_logs"
  | "openclaw_gateway_probe"
  | "openclaw_gateway_usage_cost"
  | "openclaw_doctor"
  | "openclaw_channels_list"
  | "openclaw_channels_status"
  | "openclaw_channels_capabilities"
  | "openclaw_channels_resolve"
  | "openclaw_channels_logs"
  | "openclaw_plugins_list"
  | "openclaw_plugins_inspect"
  | "openclaw_plugins_doctor"
  | "openclaw_models_status"
  | "openclaw_models_list"
  | "openclaw_models_aliases_list"
  | "openclaw_models_fallbacks_list"
  | "openclaw_config_get"
  | "openclaw_config_file"
  | "openclaw_config_validate"
  | "openclaw_config_schema"
  | "openclaw_config_schema_lookup"
  | "openclaw_security_audit"
  | "openclaw_secrets_audit"
  | "openclaw_approvals_get"
  | "openclaw_devices_list"
  | "openclaw_nodes_list"
  | "openclaw_nodes_pending"
  | "openclaw_nodes_status"
  | "openclaw_skills_check"
  | "openclaw_sandbox_explain"
  | "openclaw_sandbox_list"
  | "openclaw_system_presence";

const TOOL_NAMES: ReadonlyRpcToolName[] = [
  "openclaw_health",
  "openclaw_status",
  "openclaw_logs",
  "openclaw_gateway_probe",
  "openclaw_gateway_usage_cost",
  "openclaw_doctor",
  "openclaw_channels_list",
  "openclaw_channels_status",
  "openclaw_channels_capabilities",
  "openclaw_channels_resolve",
  "openclaw_channels_logs",
  "openclaw_plugins_list",
  "openclaw_plugins_inspect",
  "openclaw_plugins_doctor",
  "openclaw_models_status",
  "openclaw_models_list",
  "openclaw_models_aliases_list",
  "openclaw_models_fallbacks_list",
  "openclaw_config_get",
  "openclaw_config_file",
  "openclaw_config_validate",
  "openclaw_config_schema",
  "openclaw_config_schema_lookup",
  "openclaw_security_audit",
  "openclaw_secrets_audit",
  "openclaw_approvals_get",
  "openclaw_devices_list",
  "openclaw_nodes_list",
  "openclaw_nodes_pending",
  "openclaw_nodes_status",
  "openclaw_skills_check",
  "openclaw_sandbox_explain",
  "openclaw_sandbox_list",
  "openclaw_system_presence"
];

const SECRET_KEY_RE =
  /(token|secret|password|authorization|api[_-]?key|private[_-]?key|signature|cookie|session[_-]?key|credential|access[_-]?key|client[_-]?secret|refresh[_-]?token)/i;
const MAX_ARRAY_ELEMENTS_FOR_REDACTION = 300;
const CHANNEL_LOGS_FETCH_OVERSAMPLING_FACTOR = 4;
const CHANNEL_LOGS_BYTES_PER_LINE_ESTIMATE = 4_000;

export const READONLY_RPC_TOOL_DEFINITIONS: Array<{
  name: ReadonlyRpcToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: false;
    required?: string[];
  };
}> = [
  { name: "openclaw_health", description: "Gateway health snapshot (read-only).", inputSchema: { type: "object", properties: { verbose: { type: "boolean" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 } }, additionalProperties: false } },
  { name: "openclaw_status", description: "OpenClaw status family summary.", inputSchema: { type: "object", properties: { type: { enum: ["default", "deep", "usage", "all"] } }, additionalProperties: false } },
  { name: "openclaw_logs", description: "Bounded gateway logs with redaction.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 5000 }, maxBytes: { type: "integer", minimum: 1, maximum: 1000000 }, follow: { type: "boolean" }, intervalMs: { type: "integer", minimum: 100, maximum: 60000 }, format: { enum: ["default", "json", "plain"] }, localTime: { type: "boolean" } }, additionalProperties: false } },
  { name: "openclaw_gateway_probe", description: "Gateway reachability and RPC probe diagnostics.", inputSchema: { type: "object", properties: { requireRpc: { type: "boolean" }, deep: { type: "boolean" }, noProbe: { type: "boolean" }, timeoutMs: { type: "integer", minimum: 500, maximum: 120000 } }, additionalProperties: false } },
  { name: "openclaw_gateway_usage_cost", description: "Usage-cost summaries from session logs.", inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 3650 } }, additionalProperties: false } },
  { name: "openclaw_doctor", description: "Read-only diagnostics summary (no repair).", inputSchema: { type: "object", properties: { deep: { type: "boolean" }, noWorkspaceSuggestions: { type: "boolean" } }, additionalProperties: false } },
  { name: "openclaw_channels_list", description: "Configured channel accounts.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_channels_status", description: "Channel runtime status, optionally with probes. Uses gateway RPC method channels.status.", inputSchema: { type: "object", properties: { probe: { type: "boolean" }, timeoutMs: { type: "integer", minimum: 500, maximum: 120000 } }, additionalProperties: false } },
  { name: "openclaw_channels_capabilities", description: "Channel capability hints and permissions. Uses gateway RPC method channels.capabilities (capability-conditional: returns capability error if the gateway does not support this method).", inputSchema: { type: "object", properties: { channel: { type: "string", minLength: 1 }, account: { type: "string", minLength: 1 }, target: { type: "string", minLength: 1 } }, additionalProperties: false } },
  { name: "openclaw_channels_resolve", description: "Resolve channel names/mentions to IDs. Uses gateway RPC method channels.resolve (capability-conditional: returns capability error if the gateway does not support this method).", inputSchema: { type: "object", properties: { entries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 }, channel: { type: "string", minLength: 1 }, account: { type: "string", minLength: 1 }, kind: { enum: ["auto", "user", "group"] } }, required: ["entries"], additionalProperties: false } },
  { name: "openclaw_channels_logs", description: "Bounded filtered channel logs with redaction. Uses gateway RPC method logs.tail filtered by channel.", inputSchema: { type: "object", properties: { channel: { type: "string", minLength: 1 }, lines: { type: "integer", minimum: 1, maximum: 5000 } }, additionalProperties: false } },
  { name: "openclaw_plugins_list", description: "Plugin inventory. Uses gateway RPC method plugins.list (capability-conditional: returns capability error if the gateway does not support this method).", inputSchema: { type: "object", properties: { enabledOnly: { type: "boolean" }, verbose: { type: "boolean" } }, additionalProperties: false } },
  { name: "openclaw_plugins_inspect", description: "Inspect one plugin. Uses gateway RPC method plugins.inspect (capability-conditional).", inputSchema: { type: "object", properties: { id: { type: "string", minLength: 1 } }, required: ["id"], additionalProperties: false } },
  { name: "openclaw_plugins_doctor", description: "Plugin diagnostics (read-only). Uses gateway RPC method plugins.doctor (capability-conditional).", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_models_status", description: "Model/provider auth status and probes. Uses gateway RPC method models.authStatus.", inputSchema: { type: "object", properties: { check: { type: "boolean" }, probe: { type: "boolean" }, probeProvider: { type: "string", minLength: 1 }, probeProfileIds: { type: "array", items: { type: "string" }, maxItems: 50 }, probeTimeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }, probeConcurrency: { type: "integer", minimum: 1, maximum: 32 }, probeMaxTokens: { type: "integer", minimum: 1, maximum: 32000 }, agentId: { type: "string", minLength: 1 } }, additionalProperties: false } },
  { name: "openclaw_models_list", description: "List available models. Uses gateway RPC method models.list.", inputSchema: { type: "object", properties: { agentId: { type: "string", minLength: 1 } }, additionalProperties: false } },
  { name: "openclaw_models_aliases_list", description: "List model aliases derived from config.get.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_models_fallbacks_list", description: "List model fallbacks derived from config.get.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_config_get", description: "Read one config path (secret paths blocked). Uses gateway RPC method config.get.", inputSchema: { type: "object", properties: { path: { type: "string", minLength: 1 } }, required: ["path"], additionalProperties: false } },
  { name: "openclaw_config_file", description: "Active config file path derived from config.get.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_config_validate", description: "Read-only config validation result derived from config.get.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_config_schema", description: "Full config schema. Uses gateway RPC method config.schema.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_config_schema_lookup", description: "Schema metadata for one path. Uses gateway RPC method config.schema.lookup (capability-conditional).", inputSchema: { type: "object", properties: { path: { type: "string", minLength: 1 } }, required: ["path"], additionalProperties: false } },
  { name: "openclaw_security_audit", description: "Read-only security audit (no fix). Uses gateway RPC method security.audit (capability-conditional).", inputSchema: { type: "object", properties: { deep: { type: "boolean" } }, additionalProperties: false } },
  { name: "openclaw_secrets_audit", description: "Read-only secrets audit with redaction. Uses gateway RPC method secrets.audit (capability-conditional).", inputSchema: { type: "object", properties: { allowExec: { type: "boolean" }, check: { type: "boolean" } }, additionalProperties: false } },
  { name: "openclaw_approvals_get", description: "Effective exec approvals snapshot. Uses gateway RPC methods exec.approvals.get / exec.approvals.node.get.", inputSchema: { type: "object", properties: { target: { enum: ["local", "gateway", "node"] }, node: { type: "string", minLength: 1 } }, additionalProperties: false } },
  { name: "openclaw_devices_list", description: "Pending and paired devices (tokens redacted). Uses gateway RPC method device.pair.list.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_nodes_list", description: "Node list with optional filters. Uses gateway RPC methods node.list and node.pair.list.", inputSchema: { type: "object", properties: { connectedOnly: { type: "boolean" }, lastConnected: { type: "string", minLength: 1 } }, additionalProperties: false } },
  { name: "openclaw_nodes_pending", description: "Pending node pairing requests. Uses gateway RPC method node.pair.list.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_nodes_status", description: "Node status view with optional filters. Uses gateway RPC methods node.list and node.pair.list.", inputSchema: { type: "object", properties: { connectedOnly: { type: "boolean" }, lastConnected: { type: "string", minLength: 1 } }, additionalProperties: false } },
  { name: "openclaw_skills_check", description: "Skill readiness check derived from skills.status RPC.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "openclaw_sandbox_explain", description: "Explain effective sandbox policy. Uses gateway RPC method sandbox.explain (capability-conditional).", inputSchema: { type: "object", properties: { sessionKey: { type: "string", minLength: 1 }, agentId: { type: "string", minLength: 1 } }, additionalProperties: false } },
  { name: "openclaw_sandbox_list", description: "List sandbox runtimes. Uses gateway RPC method sandbox.list (capability-conditional).", inputSchema: { type: "object", properties: { browserOnly: { type: "boolean" } }, additionalProperties: false } },
  { name: "openclaw_system_presence", description: "Current gateway system presence entries. Uses gateway RPC method system-presence.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }
];

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(args: JsonObject, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`arguments.${key} must be a boolean`);
  return value;
}

function readString(args: JsonObject, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined) {
    if (required) throw new Error(`arguments.${key} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`arguments.${key} must be a non-empty string`);
  }
  return value;
}

function readInteger(args: JsonObject, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`arguments.${key} must be an integer`);
  if (value < min || value > max) throw new Error(`arguments.${key} must be between ${min} and ${max}`);
  return value;
}

function readStringArray(args: JsonObject, key: string, maxItems: number): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`arguments.${key} must be an array of strings`);
  }
  if (value.length > maxItems) throw new Error(`arguments.${key} must contain at most ${maxItems} entries`);
  return value as string[];
}

function parseDurationMs(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = raw.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * factor;
}

function isNodeConnected(entry: JsonObject): boolean {
  // Different gateway/runtime versions expose connectivity as connected/online/status.
  return entry.connected === true || entry.online === true || entry.status === "connected";
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

export function redactSensitive(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  // Arrays are bounded intentionally to prevent unbounded payload growth in diagnostics responses.
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ELEMENTS_FOR_REDACTION).map((entry) => redactSensitive(entry));
  if (isObject(value)) {
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redactSensitive(child);
    }
    return out;
  }
  return value;
}

export function isReadonlyRpcToolName(value: string): value is ReadonlyRpcToolName {
  return TOOL_NAMES.includes(value as ReadonlyRpcToolName);
}

export function validateReadonlyRpcToolArguments(toolName: ReadonlyRpcToolName, rawArguments: unknown): JsonObject {
  const args = asObject(rawArguments);
  switch (toolName) {
    case "openclaw_health":
      readBoolean(args, "verbose");
      readInteger(args, "timeoutMs", 1_000, 120_000);
      break;
    case "openclaw_status": {
      const type = readString(args, "type");
      if (type && !["default", "deep", "usage", "all"].includes(type)) {
        throw new Error("arguments.type must be one of: default, deep, usage, all");
      }
      break;
    }
    case "openclaw_logs": {
      readInteger(args, "limit", 1, 5_000);
      readInteger(args, "maxBytes", 1, 1_000_000);
      readBoolean(args, "follow");
      readInteger(args, "intervalMs", 100, 60_000);
      const format = readString(args, "format");
      if (format && !["default", "json", "plain"].includes(format)) {
        throw new Error("arguments.format must be one of: default, json, plain");
      }
      readBoolean(args, "localTime");
      break;
    }
    case "openclaw_gateway_probe":
      readBoolean(args, "requireRpc");
      readBoolean(args, "deep");
      readBoolean(args, "noProbe");
      readInteger(args, "timeoutMs", 500, 120_000);
      break;
    case "openclaw_gateway_usage_cost":
      readInteger(args, "days", 1, 3650);
      break;
    case "openclaw_doctor":
      readBoolean(args, "deep");
      readBoolean(args, "noWorkspaceSuggestions");
      break;
    case "openclaw_channels_status":
      readBoolean(args, "probe");
      readInteger(args, "timeoutMs", 500, 120_000);
      break;
    case "openclaw_channels_capabilities":
      readString(args, "channel");
      readString(args, "account");
      readString(args, "target");
      break;
    case "openclaw_channels_resolve": {
      // Runtime guard in addition to schema-level constraints.
      const entries = readStringArray(args, "entries", 50);
      if (!entries || entries.length === 0) throw new Error("arguments.entries must contain at least one entry");
      readString(args, "channel");
      readString(args, "account");
      const kind = readString(args, "kind");
      if (kind && !["auto", "user", "group"].includes(kind)) throw new Error("arguments.kind must be one of: auto, user, group");
      break;
    }
    case "openclaw_channels_logs":
      readString(args, "channel");
      readInteger(args, "lines", 1, 5000);
      break;
    case "openclaw_plugins_list":
      readBoolean(args, "enabledOnly");
      readBoolean(args, "verbose");
      break;
    case "openclaw_plugins_inspect":
      readString(args, "id", true);
      break;
    case "openclaw_models_status":
      readBoolean(args, "check");
      readBoolean(args, "probe");
      readString(args, "probeProvider");
      readStringArray(args, "probeProfileIds", 50);
      readInteger(args, "probeTimeoutMs", 1_000, 120_000);
      readInteger(args, "probeConcurrency", 1, 32);
      readInteger(args, "probeMaxTokens", 1, 32_000);
      readString(args, "agentId");
      break;
    case "openclaw_models_list":
      readString(args, "agentId");
      break;
    case "openclaw_config_get":
    case "openclaw_config_schema_lookup":
      readString(args, "path", true);
      break;
    case "openclaw_security_audit":
      readBoolean(args, "deep");
      break;
    case "openclaw_secrets_audit":
      readBoolean(args, "allowExec");
      readBoolean(args, "check");
      break;
    case "openclaw_approvals_get": {
      const target = readString(args, "target");
      if (target && !["local", "gateway", "node"].includes(target)) {
        throw new Error("arguments.target must be one of: local, gateway, node");
      }
      if (target === "node") readString(args, "node", true);
      break;
    }
    case "openclaw_nodes_list":
    case "openclaw_nodes_status":
      readBoolean(args, "connectedOnly");
      readString(args, "lastConnected");
      break;
    case "openclaw_sandbox_explain":
      readString(args, "sessionKey");
      readString(args, "agentId");
      break;
    case "openclaw_sandbox_list":
      readBoolean(args, "browserOnly");
      break;
    default:
      break;
  }
  return args;
}

function mapGatewayError(toolName: string, error: unknown): never {
  if (error instanceof GatewayRpcError) {
    if (error.kind === "capability") throw new McpError(ErrorCode.InternalError, `${toolName} is not supported by the current gateway capability`);
    if (error.kind === "timeout") throw new McpError(ErrorCode.InternalError, `Gateway timeout for ${toolName}: ${error.message}`);
    if (error.kind === "auth") throw new McpError(ErrorCode.InternalError, `Gateway auth failure for ${toolName}: ${error.message}`);
    throw new McpError(ErrorCode.InternalError, `Gateway RPC failure for ${toolName}: ${error.message}`);
  }
  throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : String(error));
}

async function rpc(gatewayConfig: GatewayConfig, toolName: string, method: string, params: JsonObject, timeoutMs: number, deviceIdentity?: DeviceIdentity): Promise<unknown> {
  try {
    return await callGatewayRpc(gatewayConfig, method, params, timeoutMs, deviceIdentity);
  } catch (error) {
    mapGatewayError(toolName, error);
  }
}

function getPathValue(root: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const index = Number(part);
      if (!Array.isArray(current) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function ensureSafeConfigPath(path: string): void {
  const sensitive = path
    .split(/[.\[\]]+/)
    .filter(Boolean)
    .some((part) => SECRET_KEY_RE.test(part));
  if (sensitive) throw new McpError(ErrorCode.InvalidParams, "Secret-bearing config paths are blocked");
}

export async function runReadonlyRpcToolWithArguments(
  toolName: ReadonlyRpcToolName,
  args: JsonObject,
  gatewayConfig: GatewayConfig,
  deviceIdentity?: DeviceIdentity
): Promise<string> {
  try {
    switch (toolName) {
      case "openclaw_health": {
        const payload = await rpc(gatewayConfig, toolName, "health", { probe: args.verbose === true }, (args.timeoutMs as number | undefined) ?? 12_000, deviceIdentity);
        return JSON.stringify(redactSensitive(payload), null, 2);
      }
      case "openclaw_status": {
        const type = (args.type as string | undefined) ?? "default";
        const status = await rpc(gatewayConfig, toolName, "status", {}, 15_000, deviceIdentity);
        const result: JsonObject = { type, status: redactSensitive(status) };
        if (type === "deep" || type === "all") {
          result.channels = redactSensitive(await rpc(gatewayConfig, toolName, "channels.status", { probe: true, timeoutMs: 10_000 }, 20_000, deviceIdentity));
        }
        if (type === "usage" || type === "all") {
          result.usage = redactSensitive(await rpc(gatewayConfig, toolName, "usage.status", {}, 20_000, deviceIdentity));
        }
        return JSON.stringify(result, null, 2);
      }
      case "openclaw_logs": {
        if (args.follow === true) {
          throw new McpError(ErrorCode.InvalidParams, "openclaw_logs follow mode is not supported over MCP in this gateway");
        }
        const payload = await rpc(
          gatewayConfig,
          toolName,
          "logs.tail",
          { limit: (args.limit as number | undefined) ?? 200, maxBytes: (args.maxBytes as number | undefined) ?? 250_000 },
          12_000,
          deviceIdentity
        );
        return JSON.stringify(redactSensitive(payload), null, 2);
      }
      case "openclaw_gateway_probe": {
        const timeoutMs = (args.timeoutMs as number | undefined) ?? 10_000;
        const noProbe = args.noProbe === true;
        const result: JsonObject = { timeoutMs, noProbe };
        if (!noProbe) {
          try {
            result.health = redactSensitive(await rpc(gatewayConfig, toolName, "health", {}, timeoutMs, deviceIdentity));
            result.status = redactSensitive(await rpc(gatewayConfig, toolName, "status", {}, timeoutMs, deviceIdentity));
            result.rpcOk = true;
          } catch (error) {
            result.rpcOk = false;
            result.rpcError = error instanceof Error ? error.message : String(error);
            if (args.requireRpc === true) throw error;
          }
        }
        if (args.deep === true) {
          try {
            result.config = redactSensitive(await rpc(gatewayConfig, toolName, "config.get", {}, timeoutMs, deviceIdentity));
          } catch (error) {
            result.configError = error instanceof Error ? error.message : String(error);
          }
        }
        return JSON.stringify(result, null, 2);
      }
      case "openclaw_gateway_usage_cost":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "usage.cost", { days: (args.days as number | undefined) ?? 30 }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_doctor": {
        const result: JsonObject = {
          health: redactSensitive(await rpc(gatewayConfig, toolName, "health", { probe: true }, 15_000, deviceIdentity)),
          status: redactSensitive(await rpc(gatewayConfig, toolName, "status", {}, 15_000, deviceIdentity))
        };
        if (args.deep === true) {
          result.channels = redactSensitive(await rpc(gatewayConfig, toolName, "channels.status", { probe: true, timeoutMs: 10_000 }, 20_000, deviceIdentity));
        }
        return JSON.stringify(result, null, 2);
      }
      case "openclaw_channels_list": {
        const config = asObject(await rpc(gatewayConfig, toolName, "config.get", {}, 12_000, deviceIdentity));
        const parsed = asObject(config.parsed);
        const channels = asObject(parsed.channels);
        return JSON.stringify(
          redactSensitive({
            total: Object.keys(channels).length,
            channels
          }),
          null,
          2
        );
      }
      case "openclaw_channels_status":
        return JSON.stringify(
          redactSensitive(
            await rpc(
              gatewayConfig,
              toolName,
              "channels.status",
              { probe: args.probe === true, timeoutMs: (args.timeoutMs as number | undefined) ?? 10_000 },
              20_000,
              deviceIdentity
            )
          ),
          null,
          2
        );
      case "openclaw_channels_capabilities":
        return JSON.stringify(
          redactSensitive(await rpc(gatewayConfig, toolName, "channels.capabilities", {
            channel: args.channel,
            account: args.account,
            target: args.target
          }, 20_000, deviceIdentity)),
          null,
          2
        );
      case "openclaw_channels_resolve":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "channels.resolve", {
          entries: args.entries,
          channel: args.channel,
          account: args.account,
          kind: args.kind
        }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_channels_logs": {
        const linesLimit = (args.lines as number | undefined) ?? 200;
        const fetchLimit = Math.min(5000, Math.max(200, linesLimit * CHANNEL_LOGS_FETCH_OVERSAMPLING_FACTOR));
        const fetchMaxBytes = Math.min(
          1_000_000,
          Math.max(100_000, linesLimit * CHANNEL_LOGS_FETCH_OVERSAMPLING_FACTOR * CHANNEL_LOGS_BYTES_PER_LINE_ESTIMATE)
        );
        const payload = asObject(await rpc(gatewayConfig, toolName, "logs.tail", { limit: fetchLimit, maxBytes: fetchMaxBytes }, 12_000, deviceIdentity));
        const channel = typeof args.channel === "string" ? args.channel : "all";
        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        const filtered = lines
          .map((line) => String(line))
          .filter((line) => channel === "all" || line.includes(`gateway/channels/${channel}`))
          .slice(-linesLimit);
        return JSON.stringify(redactSensitive({ channel, lines: filtered, returned: filtered.length }), null, 2);
      }
      case "openclaw_plugins_list":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "plugins.list", {
          enabledOnly: args.enabledOnly === true,
          verbose: args.verbose === true
        }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_plugins_inspect":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "plugins.inspect", { id: args.id }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_plugins_doctor":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "plugins.doctor", {}, 20_000, deviceIdentity)), null, 2);
      case "openclaw_models_status": {
        const status = await rpc(gatewayConfig, toolName, "models.authStatus", { refresh: args.probe === true }, 20_000, deviceIdentity);
        const result: JsonObject = { status: redactSensitive(status) };
        if (args.check === true) {
          const providers = Array.isArray((status as JsonObject).providers) ? ((status as JsonObject).providers as unknown[]) : [];
          const bad = providers.filter((entry) => {
            const p = asObject(entry);
            const s = p.status;
            return s === "missing" || s === "expired";
          }).length;
          result.check = { ok: bad === 0, failingProviders: bad };
        }
        return JSON.stringify(result, null, 2);
      }
      case "openclaw_models_list":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "models.list", {}, 35_000, deviceIdentity)), null, 2);
      case "openclaw_models_aliases_list":
      case "openclaw_models_fallbacks_list": {
        const config = asObject(await rpc(gatewayConfig, toolName, "config.get", {}, 12_000, deviceIdentity));
        const parsed = asObject(config.parsed);
        const models = asObject(parsed.models);
        const value = toolName === "openclaw_models_aliases_list" ? models.aliases : models.fallbacks;
        return JSON.stringify(redactSensitive(value ?? (toolName === "openclaw_models_aliases_list" ? {} : [])), null, 2);
      }
      case "openclaw_config_get": {
        const path = String(args.path);
        ensureSafeConfigPath(path);
        const payload = asObject(await rpc(gatewayConfig, toolName, "config.get", {}, 12_000, deviceIdentity));
        const parsed = payload.parsed;
        const value = getPathValue(parsed, path);
        return JSON.stringify(redactSensitive({ path, exists: value !== undefined, value: value ?? null }), null, 2);
      }
      case "openclaw_config_file": {
        const payload = asObject(await rpc(gatewayConfig, toolName, "config.get", {}, 12_000, deviceIdentity));
        return JSON.stringify({ path: payload.path ?? null, exists: payload.exists === true }, null, 2);
      }
      case "openclaw_config_validate": {
        const payload = asObject(await rpc(gatewayConfig, toolName, "config.get", {}, 12_000, deviceIdentity));
        return JSON.stringify(redactSensitive({ valid: payload.valid === true, issues: payload.issues ?? [], warnings: payload.warnings ?? [] }), null, 2);
      }
      case "openclaw_config_schema":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "config.schema", {}, 15_000, deviceIdentity)), null, 2);
      case "openclaw_config_schema_lookup":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "config.schema.lookup", { path: args.path }, 15_000, deviceIdentity)), null, 2);
      case "openclaw_security_audit":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "security.audit", { deep: args.deep === true }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_secrets_audit":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "secrets.audit", { check: args.check === true, allowExec: args.allowExec === true }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_approvals_get": {
        const target = (args.target as string | undefined) ?? "local";
        if (target === "node") {
          return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "exec.approvals.node.get", { nodeId: args.node }, 20_000, deviceIdentity)), null, 2);
        }
        if (target === "gateway") {
          return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "exec.approvals.get", {}, 20_000, deviceIdentity)), null, 2);
        }
        return JSON.stringify({ target: "local", note: "Local approvals are not available through gateway RPC; use target=gateway or target=node." }, null, 2);
      }
      case "openclaw_devices_list":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "device.pair.list", {}, 15_000, deviceIdentity)), null, 2);
      case "openclaw_nodes_pending": {
        const payload = asObject(await rpc(gatewayConfig, toolName, "node.pair.list", {}, 15_000, deviceIdentity));
        return JSON.stringify(redactSensitive({ pending: payload.pending ?? [] }), null, 2);
      }
      case "openclaw_nodes_list":
      case "openclaw_nodes_status": {
        const connectedOnly = args.connectedOnly === true;
        const sinceMs = parseDurationMs(typeof args.lastConnected === "string" ? args.lastConnected : undefined);
        const now = Date.now();
        const listPayload = asObject(await rpc(gatewayConfig, toolName, "node.list", {}, 15_000, deviceIdentity));
        const pairPayload = asObject(await rpc(gatewayConfig, toolName, "node.pair.list", {}, 15_000, deviceIdentity));
        const nodes = Array.isArray(listPayload.nodes) ? listPayload.nodes.map((entry) => asObject(entry)) : [];
        const paired = Array.isArray(pairPayload.paired) ? pairPayload.paired.map((entry) => asObject(entry)) : [];
        const connectedMap = new Map(nodes.map((entry) => [String(entry.nodeId ?? ""), entry]));
        const pairedByNodeId = new Map(paired.map((entry) => [String(entry.nodeId ?? ""), entry]));
        const filteredPaired = paired.filter((entry) => {
          const nodeId = String(entry.nodeId ?? "");
          const connected = connectedMap.get(nodeId);
          if (connectedOnly && !connected) return false;
          if (sinceMs !== undefined) {
            const last = typeof entry.lastConnectedAt === "number" ? entry.lastConnectedAt : undefined;
            if (last === undefined || now - last > sinceMs) return false;
          }
          return true;
        });
        if (toolName === "openclaw_nodes_status") {
          const filteredNodes = nodes.filter((entry) => {
            const nodeId = String(entry.nodeId ?? "");
            const connected = isNodeConnected(entry);
            if (connectedOnly && !connected) return false;
            if (sinceMs !== undefined) {
              const pairedEntry = pairedByNodeId.get(nodeId);
              const nodeLastConnected =
                typeof entry.lastConnectedAt === "number"
                  ? entry.lastConnectedAt
                  : typeof entry.lastSeenAt === "number"
                    ? entry.lastSeenAt
                    : typeof pairedEntry?.lastConnectedAt === "number"
                      ? pairedEntry.lastConnectedAt
                      : undefined;
              if (nodeLastConnected === undefined || now - nodeLastConnected > sinceMs) return false;
            }
            return true;
          });
          return JSON.stringify(redactSensitive({ ts: listPayload.ts ?? Date.now(), nodes: filteredNodes }), null, 2);
        }
        return JSON.stringify(redactSensitive({ pending: pairPayload.pending ?? [], paired: filteredPaired }), null, 2);
      }
      case "openclaw_skills_check": {
        const payload = asObject(await rpc(gatewayConfig, toolName, "skills.status", {}, 20_000, deviceIdentity));
        const skills = Array.isArray(payload.skills) ? payload.skills.map((entry) => asObject(entry)) : [];
        const ready = skills.filter((entry) => entry.eligible === true).length;
        return JSON.stringify(redactSensitive({ ready, total: skills.length, skills }), null, 2);
      }
      case "openclaw_sandbox_explain":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "sandbox.explain", { sessionKey: args.sessionKey, agentId: args.agentId }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_sandbox_list":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "sandbox.list", { browser: args.browserOnly === true }, 20_000, deviceIdentity)), null, 2);
      case "openclaw_system_presence":
        return JSON.stringify(redactSensitive(await rpc(gatewayConfig, toolName, "system-presence", {}, 12_000, deviceIdentity)), null, 2);
      default:
        return JSON.stringify({ error: "unsupported tool" }, null, 2);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    mapGatewayError(toolName, error);
  }
}
