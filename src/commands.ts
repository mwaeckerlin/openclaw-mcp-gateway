import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CronToolName, isCronToolName } from "./cron.js";

type JsonObject = Record<string, unknown>;

export type HttpToolName =
  | "openclaw_gateway_status"
  | "openclaw_sessions_list"
  | "openclaw_session_status";

export type AllowedToolName = HttpToolName | CronToolName;

export interface GatewayInvokePayload {
  tool: string;
  action?: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  dryRun?: boolean;
}

interface BaseGatewayOperation {
  requestKind: "invoke" | "check";
  timeoutMs: number;
  description: string;
}

interface InvokeGatewayOperation extends BaseGatewayOperation {
  requestKind: "invoke";
  tool: string;
  action?: string;
}

interface CheckGatewayOperation extends BaseGatewayOperation {
  requestKind: "check";
}

export type AllowedGatewayOperation = InvokeGatewayOperation | CheckGatewayOperation;

export interface GatewayConfig {
  baseUrl: string;
  token: string;
}

const ALLOWED_SESSION_KINDS = ["main", "group", "cron", "hook", "node"] as const;

const STATUS_SAFE_FIELDS = [
  "ok",
  "status",
  "version",
  "build",
  "uptime",
  "uptimeMs",
  "uptimeSeconds",
  "enabledPlugins",
  "enabledChannels",
  "authConfigured",
  "cronEnabled"
] as const;

const SESSION_SAFE_FIELDS = [
  "sessionKey",
  "sessionId",
  "kind",
  "agentId",
  "channel",
  "model",
  "createdAtMs",
  "updatedAtMs",
  "lastActivityAtMs",
  "lastMessageAtMs",
  "inputTokens",
  "outputTokens",
  "totalTokens"
] as const;

const SESSION_STATUS_SAFE_FIELDS = [
  "sessionKey",
  "sessionId",
  "kind",
  "agentId",
  "channel",
  "status",
  "model",
  "runtime",
  "createdAtMs",
  "updatedAtMs",
  "lastActivityAtMs"
] as const;

const SESSION_STATUS_USAGE_SAFE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "requestCount"
] as const;

const SESSION_STATUS_TASK_SAFE_FIELDS = ["runId", "runtime", "status", "startedAtMs", "updatedAtMs"] as const;

export const ALLOWED_HTTP_GATEWAY_OPERATIONS: Record<HttpToolName, AllowedGatewayOperation> = {
  openclaw_gateway_status: {
    requestKind: "check",
    timeoutMs: 12_000,
    description: "Return a curated OpenClaw gateway health summary from GET /healthz."
  },
  openclaw_sessions_list: {
    requestKind: "invoke",
    timeoutMs: 12_000,
    description: "List visible OpenClaw sessions with strict local filtering and bounded paging.",
    tool: "sessions_list",
    action: "json"
  },
  openclaw_session_status: {
    requestKind: "invoke",
    timeoutMs: 12_000,
    description: "Read status for one explicitly targeted OpenClaw session.",
    tool: "session_status",
    action: "json"
  }
};

export function isAllowedToolName(value: string): value is AllowedToolName {
  return isHttpToolName(value) || isCronToolName(value);
}

export function isHttpToolName(value: string): value is HttpToolName {
  return Object.hasOwn(ALLOWED_HTTP_GATEWAY_OPERATIONS, value);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function assertAllowedKeys(value: JsonObject, path: string, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${path}.${key} is not supported`);
    }
  }
}

function readOptionalString(value: JsonObject, key: string, path: string, minLength = 0): string | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new Error(`${path}.${key} must be a string`);
  }
  if (raw.length < minLength) {
    throw new Error(`${path}.${key} must be at least ${minLength} characters`);
  }
  return raw;
}

function readOptionalInteger(
  value: JsonObject,
  key: string,
  path: string,
  minimum?: number,
  maximum?: number
): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error(`${path}.${key} must be an integer`);
  }
  if (minimum !== undefined && raw < minimum) {
    throw new Error(`${path}.${key} must be >= ${minimum}`);
  }
  if (maximum !== undefined && raw > maximum) {
    throw new Error(`${path}.${key} must be <= ${maximum}`);
  }
  return raw;
}

function clampPagingInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

function parseInvokeError(parsed: JsonObject): string {
  const error = parsed.error;
  if (!isObject(error)) {
    return "Gateway invoke failed";
  }
  const type = typeof error.type === "string" ? error.type : undefined;
  const message = typeof error.message === "string" ? error.message : undefined;
  const reason = [type, message].filter(Boolean).join(": ");
  return reason || "Gateway invoke failed";
}

function readInvokeDetails(bodyText: string): JsonObject {
  const parsed = JSON.parse(bodyText) as JsonObject;
  if (parsed.ok === false) {
    throw new Error(parseInvokeError(parsed));
  }

  const result = parsed.result;
  if (isObject(result)) {
    const details = result.details;
    if (isObject(details)) {
      return details;
    }
  }

  return {};
}

function pickSafeFields(source: JsonObject, fields: readonly string[]): JsonObject {
  const output: JsonObject = {};
  for (const key of fields) {
    const value = source[key];
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((entry) => typeof entry === "string").map((entry) => entry as string);
  return strings.length > 0 ? strings.slice(0, 100) : undefined;
}

function sanitizeSessionEntry(value: unknown): JsonObject | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const safe = pickSafeFields(value, SESSION_SAFE_FIELDS);
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function shapeSessionsList(details: JsonObject, args: JsonObject): string {
  const sessionsRaw = Array.isArray(details.sessions) ? details.sessions : [];
  const sessions = sessionsRaw.map((entry) => sanitizeSessionEntry(entry)).filter((entry): entry is JsonObject => Boolean(entry));

  const limit = clampPagingInteger(args.limit, 20, 1, 100);
  const offset = clampPagingInteger(args.offset, 0, 0, 1_000);
  const paged = sessions.slice(offset, offset + limit);

  return JSON.stringify(
    {
      total: typeof details.count === "number" ? details.count : sessions.length,
      offset,
      limit,
      returned: paged.length,
      sessions: paged
    },
    null,
    2
  );
}

function shapeSessionStatus(details: JsonObject): string {
  const output: JsonObject = pickSafeFields(details, SESSION_STATUS_SAFE_FIELDS);

  if (isObject(details.usage)) {
    const usage = pickSafeFields(details.usage, SESSION_STATUS_USAGE_SAFE_FIELDS);
    if (Object.keys(usage).length > 0) {
      output.usage = usage;
    }
  }

  if (isObject(details.task)) {
    const task = pickSafeFields(details.task, SESSION_STATUS_TASK_SAFE_FIELDS);
    if (Object.keys(task).length > 0) {
      output.task = task;
    }
  }

  if (Object.keys(output).length === 0) {
    output.status = "unknown";
  }

  return JSON.stringify(output, null, 2);
}

function shapeGatewayStatus(bodyText: string): string {
  const parsed = JSON.parse(bodyText) as JsonObject;
  const safe = pickSafeFields(parsed, STATUS_SAFE_FIELDS);

  const enabledPlugins = sanitizeStringArray(parsed.enabledPlugins);
  if (enabledPlugins) {
    safe.enabledPlugins = enabledPlugins;
  }

  const enabledChannels = sanitizeStringArray(parsed.enabledChannels);
  if (enabledChannels) {
    safe.enabledChannels = enabledChannels;
  }

  return JSON.stringify(safe, null, 2);
}

function validateOpenclawSessionsListArgs(rawArguments: unknown): JsonObject {
  const args = expectObject(rawArguments ?? {}, "arguments");
  assertAllowedKeys(args, "arguments", ["kind", "activeMinutes", "limit", "offset"]);

  const kind = readOptionalString(args, "kind", "arguments");
  if (kind && !ALLOWED_SESSION_KINDS.includes(kind as (typeof ALLOWED_SESSION_KINDS)[number])) {
    throw new Error(`arguments.kind must be one of: ${ALLOWED_SESSION_KINDS.join(", ")}`);
  }

  readOptionalInteger(args, "activeMinutes", "arguments", 1, 10_080);
  readOptionalInteger(args, "limit", "arguments", 1, 100);
  readOptionalInteger(args, "offset", "arguments", 0, 1_000);
  return args;
}

function validateOpenclawSessionStatusArgs(rawArguments: unknown): JsonObject {
  const args = expectObject(rawArguments ?? {}, "arguments");
  assertAllowedKeys(args, "arguments", ["sessionKey", "sessionId"]);

  const sessionKey = readOptionalString(args, "sessionKey", "arguments", 1);
  const sessionId = readOptionalString(args, "sessionId", "arguments", 1);

  if ((sessionKey ? 1 : 0) + (sessionId ? 1 : 0) !== 1) {
    throw new Error("arguments must contain exactly one of sessionKey or sessionId");
  }

  return args;
}

function validateNoArguments(rawArguments: unknown): JsonObject {
  const args = expectObject(rawArguments ?? {}, "arguments");
  assertAllowedKeys(args, "arguments", []);
  return args;
}

export function validateHttpToolArguments(toolName: HttpToolName, rawArguments: unknown): JsonObject {
  switch (toolName) {
    case "openclaw_gateway_status":
      return validateNoArguments(rawArguments);
    case "openclaw_sessions_list":
      return validateOpenclawSessionsListArgs(rawArguments);
    case "openclaw_session_status":
      return validateOpenclawSessionStatusArgs(rawArguments);
  }
}

export function buildHttpInvokePayload(toolName: HttpToolName, validatedArguments: JsonObject): GatewayInvokePayload {
  const operation = ALLOWED_HTTP_GATEWAY_OPERATIONS[toolName];
  if (operation.requestKind !== "invoke") {
    throw new Error(`${toolName} is not an invoke operation`);
  }

  return {
    tool: operation.tool,
    action: operation.action,
    args: validatedArguments
  };
}

export function shapeHttpToolResponse(
  toolName: HttpToolName,
  response: Response,
  bodyText: string,
  validatedArguments: JsonObject
): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "(no output)";
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  if (!isJson) {
    return trimmed;
  }

  try {
    if (toolName === "openclaw_gateway_status") {
      return shapeGatewayStatus(trimmed);
    }

    const details = readInvokeDetails(trimmed);
    switch (toolName) {
      case "openclaw_sessions_list":
        return shapeSessionsList(details, validatedArguments);
      case "openclaw_session_status":
        return shapeSessionStatus(details);
      default:
        return JSON.stringify(details, null, 2);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${toolName} response validation failed: ${message}`);
  }
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("OPENCLAW_GATEWAY_URL is empty");
  }

  const parsed = new URL(trimmed);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OPENCLAW_GATEWAY_URL must use http or https");
  }

  return parsed.toString();
}

function validateFilePath(pathValue: string, envVar: string): string {
  if (!isAbsolute(pathValue)) {
    throw new Error(`${envVar} must be an absolute path`);
  }

  if (pathValue.includes("\u0000")) {
    throw new Error(`${envVar} contains invalid characters`);
  }

  return pathValue;
}

function validateGatewayToken(token: string): string {
  if (token.includes("\r") || token.includes("\n")) {
    throw new Error("Gateway token must not contain line breaks");
  }

  return token;
}

function readSecret(
  inlineEnvVar: string,
  fileEnvVar: string | undefined,
  legacyInlineEnvVar?: string,
  defaultFilePath?: string
): string {
  const inline = process.env[inlineEnvVar]?.trim();
  if (inline) {
    return validateGatewayToken(inline);
  }

  if (legacyInlineEnvVar) {
    const legacyInline = process.env[legacyInlineEnvVar]?.trim();
    if (legacyInline) {
      return validateGatewayToken(legacyInline);
    }
  }

  if (fileEnvVar) {
    const filePath = process.env[fileEnvVar]?.trim();
    if (filePath) {
      const validatedPath = validateFilePath(filePath, fileEnvVar);
      const fileValue = readFileSync(validatedPath, "utf8").trim();
      if (fileValue) {
        return validateGatewayToken(fileValue);
      }
      throw new Error(`${fileEnvVar} is empty`);
    }
  }

  if (defaultFilePath && existsSync(defaultFilePath)) {
    const fileValue = readFileSync(defaultFilePath, "utf8").trim();
    if (fileValue) {
      return validateGatewayToken(fileValue);
    }
    throw new Error(`${defaultFilePath} is empty`);
  }

  const inlineHint = legacyInlineEnvVar ? `${inlineEnvVar} or ${legacyInlineEnvVar}` : inlineEnvVar;
  const fileHint = fileEnvVar ?? "";
  throw new Error(`Set ${inlineHint}${fileHint ? ` or ${fileHint}` : ""}`);
}

export function loadGatewayConfig(): GatewayConfig {
  const baseUrlEnv = process.env.OPENCLAW_GATEWAY_URL?.trim() || "http://openclaw:18789";

  return {
    baseUrl: normalizeUrl(baseUrlEnv),
    token: readSecret(
      "OPENCLAW_GATEWAY_TOKEN",
      undefined,
      "OPENCLAW_GATEWAY_KEY",
      "/run/secret/openclaw_gateway_token"
    )
  };
}
