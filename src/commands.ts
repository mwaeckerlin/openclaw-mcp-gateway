import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export type AllowedToolName =
  | "openclaw_status"
  | "openclaw_gateway_status"
  | "openclaw_logs";

export interface GatewayInvokePayload {
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface AllowedGatewayOperation {
  timeoutMs: number;
  description: string;
  payloadEnvVar: string;
}

export interface GatewayConfig {
  baseUrl: string;
  token: string;
  invokePayloads: Partial<Record<AllowedToolName, GatewayInvokePayload>>;
}

export const ALLOWED_GATEWAY_OPERATIONS: Record<AllowedToolName, AllowedGatewayOperation> = {
  openclaw_status: {
    timeoutMs: 12_000,
    description: "Return overall OpenClaw status from the Gateway API.",
    payloadEnvVar: "OPENCLAW_STATUS_PAYLOAD_JSON"
  },
  openclaw_gateway_status: {
    timeoutMs: 12_000,
    description: "Return OpenClaw gateway status from the Gateway API.",
    payloadEnvVar: "OPENCLAW_GATEWAY_STATUS_PAYLOAD_JSON"
  },
  openclaw_logs: {
    timeoutMs: 18_000,
    description: "Return OpenClaw logs from the Gateway API.",
    payloadEnvVar: "OPENCLAW_LOGS_PAYLOAD_JSON"
  }
};

export function isAllowedToolName(value: string): value is AllowedToolName {
  return Object.hasOwn(ALLOWED_GATEWAY_OPERATIONS, value);
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
  fileEnvVar: string,
  legacyInlineEnvVar?: string,
  legacyFileEnvVar?: string
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

  const filePath = process.env[fileEnvVar]?.trim();
  if (filePath) {
    const validatedPath = validateFilePath(filePath, fileEnvVar);
    const fileValue = readFileSync(validatedPath, "utf8").trim();
    if (fileValue) {
      return validateGatewayToken(fileValue);
    }
    throw new Error(`${fileEnvVar} is empty`);
  }

  if (legacyFileEnvVar) {
    const legacyFilePath = process.env[legacyFileEnvVar]?.trim();
    if (legacyFilePath) {
      const validatedPath = validateFilePath(legacyFilePath, legacyFileEnvVar);
      const fileValue = readFileSync(validatedPath, "utf8").trim();
      if (fileValue) {
        return validateGatewayToken(fileValue);
      }
      throw new Error(`${legacyFileEnvVar} is empty`);
    }
  }

  const inlineHint = legacyInlineEnvVar ? `${inlineEnvVar} or ${legacyInlineEnvVar}` : inlineEnvVar;
  const fileHint = legacyFileEnvVar ? `${fileEnvVar} or ${legacyFileEnvVar}` : fileEnvVar;
  throw new Error(`Set ${inlineHint} or ${fileHint}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePayloadJson(rawPayload: string, envVar: string): GatewayInvokePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    throw new Error(`${envVar} must be valid JSON`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`${envVar} must be a JSON object`);
  }

  const payloadData = parsed as { tool?: unknown; arguments?: unknown };
  const gatewayToolName = typeof payloadData.tool === "string" ? payloadData.tool.trim() : "";
  if (!gatewayToolName) {
    throw new Error(`${envVar} must include a non-empty string field 'tool'`);
  }

  if (payloadData.arguments !== undefined && !isPlainObject(payloadData.arguments)) {
    throw new Error(`${envVar}.arguments must be a JSON object when provided`);
  }

  return {
    tool: gatewayToolName,
    arguments: payloadData.arguments as Record<string, unknown> | undefined
  };
}

function loadOptionalInvokePayload(operation: AllowedGatewayOperation): GatewayInvokePayload | undefined {
  const rawPayload = process.env[operation.payloadEnvVar]?.trim();
  if (!rawPayload) {
    return undefined;
  }

  return parsePayloadJson(rawPayload, operation.payloadEnvVar);
}

export function loadGatewayConfig(): GatewayConfig {
  const baseUrlEnv = process.env.OPENCLAW_GATEWAY_URL;
  if (!baseUrlEnv) {
    throw new Error("OPENCLAW_GATEWAY_URL is required");
  }

  const invokePayloads: Partial<Record<AllowedToolName, GatewayInvokePayload>> = {};
  const operationEntries = Object.entries(ALLOWED_GATEWAY_OPERATIONS) as [
    AllowedToolName,
    AllowedGatewayOperation
  ][];

  for (const [toolName, operation] of operationEntries) {
    const payload = loadOptionalInvokePayload(operation);
    if (payload) {
      invokePayloads[toolName] = payload;
    }
  }

  return {
    baseUrl: normalizeUrl(baseUrlEnv),
    token: readSecret(
      "OPENCLAW_GATEWAY_TOKEN",
      "OPENCLAW_GATEWAY_TOKEN_FILE",
      "OPENCLAW_GATEWAY_KEY",
      "OPENCLAW_GATEWAY_KEY_FILE"
    ),
    invokePayloads
  };
}
