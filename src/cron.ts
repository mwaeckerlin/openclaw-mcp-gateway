type JsonObject = Record<string, unknown>;

export type CronToolName =
  | "openclaw_cron_status"
  | "openclaw_cron_list"
  | "openclaw_cron_add"
  | "openclaw_cron_update"
  | "openclaw_cron_remove"
  | "openclaw_cron_run"
  | "openclaw_cron_runs";

export interface CronRpcOperation {
  method: "cron.status" | "cron.list" | "cron.add" | "cron.update" | "cron.remove" | "cron.run" | "cron.runs";
  timeoutMs: number;
  description: string;
}

const CRON_TOOL_NAMES: CronToolName[] = [
  "openclaw_cron_status",
  "openclaw_cron_list",
  "openclaw_cron_add",
  "openclaw_cron_update",
  "openclaw_cron_remove",
  "openclaw_cron_run",
  "openclaw_cron_runs"
];

export const CRON_RPC_OPERATIONS: Record<CronToolName, CronRpcOperation> = {
  openclaw_cron_status: {
    method: "cron.status",
    timeoutMs: 12_000,
    description: "Return OpenClaw cron scheduler status."
  },
  openclaw_cron_list: {
    method: "cron.list",
    timeoutMs: 15_000,
    description: "List OpenClaw cron jobs with optional paging/filter/sort."
  },
  openclaw_cron_add: {
    method: "cron.add",
    timeoutMs: 20_000,
    description: "Create an OpenClaw cron job with full upstream schedule/payload/delivery fields."
  },
  openclaw_cron_update: {
    method: "cron.update",
    timeoutMs: 20_000,
    description: "Patch an OpenClaw cron job by id or jobId."
  },
  openclaw_cron_remove: {
    method: "cron.remove",
    timeoutMs: 12_000,
    description: "Remove an OpenClaw cron job by id or jobId."
  },
  openclaw_cron_run: {
    method: "cron.run",
    timeoutMs: 20_000,
    description:
      "Trigger a cron job immediately (may return enqueued=true); use openclaw_cron_runs to inspect actual execution outcome."
  },
  openclaw_cron_runs: {
    method: "cron.runs",
    timeoutMs: 15_000,
    description: "Inspect cron run history and filter by scope, status, delivery status, and paging fields."
  }
};

const SESSION_TARGET_RE = /^session:.+/;
const NON_EMPTY_STRING_REQUIRING = new Set<string>(["name", "id", "jobId", "expr", "at", "text", "message", "accountId"]);
const CRON_STATUS_VALUES = ["ok", "error", "skipped"] as const;
const DELIVERY_STATUS_VALUES = ["delivered", "not-delivered", "unknown", "not-requested"] as const;

export function isCronToolName(value: string): value is CronToolName {
  return CRON_TOOL_NAMES.includes(value as CronToolName);
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

function readOptionalString(value: JsonObject, key: string, path: string): string | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new Error(`${path}.${key} must be a string`);
  }
  if (NON_EMPTY_STRING_REQUIRING.has(key) && raw.length < 1) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return raw;
}

function readOptionalNullableNonEmptyString(
  value: JsonObject,
  key: string,
  path: string
): string | null | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length < 1) {
    throw new Error(`${path}.${key} must be a non-empty string or null`);
  }
  return raw;
}

function readOptionalBoolean(value: JsonObject, key: string, path: string): boolean | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw new Error(`${path}.${key} must be a boolean`);
  }
  return raw;
}

function readOptionalNumber(
  value: JsonObject,
  key: string,
  path: string,
  minimum?: number
): number | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`${path}.${key} must be a number`);
  }
  if (minimum !== undefined && raw < minimum) {
    throw new Error(`${path}.${key} must be >= ${minimum}`);
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

function readOptionalEnum<T extends string>(
  value: JsonObject,
  key: string,
  path: string,
  allowed: readonly T[]
): T | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    throw new Error(`${path}.${key} must be one of: ${allowed.join(", ")}`);
  }
  return raw as T;
}

function readOptionalStringArray(
  value: JsonObject,
  key: string,
  path: string,
  minItems?: number,
  maxItems?: number
): string[] | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    throw new Error(`${path}.${key} must be an array of strings`);
  }
  if (minItems !== undefined && raw.length < minItems) {
    throw new Error(`${path}.${key} must contain at least ${minItems} entries`);
  }
  if (maxItems !== undefined && raw.length > maxItems) {
    throw new Error(`${path}.${key} must contain at most ${maxItems} entries`);
  }
  return raw;
}

function validateSessionTarget(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
  if (value === "main" || value === "isolated" || value === "current" || SESSION_TARGET_RE.test(value)) {
    return value;
  }
  throw new Error(`${path} must be one of main, isolated, current, or session:<id>`);
}

function validateSchedule(value: unknown, path: string): JsonObject {
  const obj = expectObject(value, path);
  assertAllowedKeys(obj, path, ["kind", "at", "everyMs", "anchorMs", "expr", "tz", "staggerMs"]);
  const kind = readOptionalEnum(obj, "kind", path, ["at", "every", "cron"]);
  if (!kind) {
    throw new Error(`${path}.kind is required`);
  }
  if (kind === "at") {
    assertAllowedKeys(obj, path, ["kind", "at"]);
    readOptionalString(obj, "at", path);
    if (typeof obj.at !== "string" || obj.at.length < 1) {
      throw new Error(`${path}.at must be a non-empty string`);
    }
  } else if (kind === "every") {
    assertAllowedKeys(obj, path, ["kind", "everyMs", "anchorMs"]);
    readOptionalInteger(obj, "everyMs", path, 1);
    if (obj.everyMs === undefined) {
      throw new Error(`${path}.everyMs is required`);
    }
    readOptionalInteger(obj, "anchorMs", path, 0);
  } else {
    assertAllowedKeys(obj, path, ["kind", "expr", "tz", "staggerMs"]);
    readOptionalString(obj, "expr", path);
    if (typeof obj.expr !== "string" || obj.expr.length < 1) {
      throw new Error(`${path}.expr must be a non-empty string`);
    }
    readOptionalString(obj, "tz", path);
    readOptionalInteger(obj, "staggerMs", path, 0);
  }
  return obj;
}

function validateFailureDestination(value: unknown, path: string): JsonObject {
  const obj = expectObject(value, path);
  assertAllowedKeys(obj, path, ["channel", "to", "accountId", "mode"]);
  const channel = readOptionalString(obj, "channel", path);
  if (channel !== undefined && channel !== "last" && channel.length < 1) {
    throw new Error(`${path}.channel must be "last" or a non-empty string`);
  }
  readOptionalString(obj, "to", path);
  readOptionalString(obj, "accountId", path);
  if (obj.accountId !== undefined && typeof obj.accountId === "string" && obj.accountId.length < 1) {
    throw new Error(`${path}.accountId must be a non-empty string`);
  }
  readOptionalEnum(obj, "mode", path, ["announce", "webhook"]);
  return obj;
}

function validateFailureAlert(value: unknown, path: string): false | JsonObject {
  if (value === false) {
    return false;
  }
  const obj = expectObject(value, path);
  assertAllowedKeys(obj, path, ["after", "channel", "to", "cooldownMs", "mode", "accountId"]);
  readOptionalInteger(obj, "after", path, 1);
  const channel = readOptionalString(obj, "channel", path);
  if (channel !== undefined && channel !== "last" && channel.length < 1) {
    throw new Error(`${path}.channel must be "last" or a non-empty string`);
  }
  readOptionalString(obj, "to", path);
  readOptionalInteger(obj, "cooldownMs", path, 0);
  readOptionalEnum(obj, "mode", path, ["announce", "webhook"]);
  readOptionalString(obj, "accountId", path);
  if (obj.accountId !== undefined && typeof obj.accountId === "string" && obj.accountId.length < 1) {
    throw new Error(`${path}.accountId must be a non-empty string`);
  }
  return obj;
}

function validateDelivery(value: unknown, path: string, patch: boolean): JsonObject {
  const obj = expectObject(value, path);
  assertAllowedKeys(obj, path, ["mode", "to", "channel", "accountId", "bestEffort", "failureDestination"]);
  const mode = patch ?
      readOptionalEnum(obj, "mode", path, ["none", "announce", "webhook"])
    : readOptionalEnum(obj, "mode", path, ["none", "announce", "webhook"]);
  if (!patch && mode === undefined) {
    throw new Error(`${path}.mode is required`);
  }
  readOptionalString(obj, "to", path);
  const channel = readOptionalString(obj, "channel", path);
  if (channel !== undefined && channel !== "last" && channel.length < 1) {
    throw new Error(`${path}.channel must be "last" or a non-empty string`);
  }
  readOptionalString(obj, "accountId", path);
  if (obj.accountId !== undefined && typeof obj.accountId === "string" && obj.accountId.length < 1) {
    throw new Error(`${path}.accountId must be a non-empty string`);
  }
  readOptionalBoolean(obj, "bestEffort", path);
  if (obj.failureDestination !== undefined) {
    validateFailureDestination(obj.failureDestination, `${path}.failureDestination`);
  }
  if (!patch && mode === "webhook") {
    if (typeof obj.to !== "string" || obj.to.length < 1) {
      throw new Error(`${path}.to must be a non-empty string when mode is webhook`);
    }
  }
  return obj;
}

function validateAgentTurnPayload(value: JsonObject, path: string, patch: boolean): JsonObject {
  const allowed = [
    "kind",
    "message",
    "model",
    "fallbacks",
    "thinking",
    "timeoutSeconds",
    "allowUnsafeExternalContent",
    "lightContext",
    "toolsAllow"
  ];
  assertAllowedKeys(value, path, allowed);
  if (!patch) {
    if (typeof value.message !== "string" || value.message.length < 1) {
      throw new Error(`${path}.message must be a non-empty string`);
    }
  } else if (value.message !== undefined && (typeof value.message !== "string" || value.message.length < 1)) {
    throw new Error(`${path}.message must be a non-empty string when provided`);
  }
  readOptionalString(value, "model", path);
  readOptionalString(value, "thinking", path);
  readOptionalNumber(value, "timeoutSeconds", path, 0);
  readOptionalBoolean(value, "allowUnsafeExternalContent", path);
  readOptionalBoolean(value, "lightContext", path);
  readOptionalStringArray(value, "fallbacks", path);
  if (patch) {
    const toolsAllow = value.toolsAllow;
    if (
      toolsAllow !== undefined &&
      toolsAllow !== null &&
      (!Array.isArray(toolsAllow) || toolsAllow.some((entry) => typeof entry !== "string"))
    ) {
      throw new Error(`${path}.toolsAllow must be null or an array of strings`);
    }
  } else if (
    value.toolsAllow !== undefined &&
    (!Array.isArray(value.toolsAllow) || value.toolsAllow.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`${path}.toolsAllow must be an array of strings`);
  }
  return value;
}

function validatePayload(value: unknown, path: string, patch: boolean): JsonObject {
  const obj = expectObject(value, path);
  const kind = readOptionalEnum(obj, "kind", path, ["systemEvent", "agentTurn"]);
  if (!kind) {
    throw new Error(`${path}.kind is required`);
  }
  if (kind === "systemEvent") {
    assertAllowedKeys(obj, path, ["kind", "text"]);
    if (!patch) {
      if (typeof obj.text !== "string" || obj.text.length < 1) {
        throw new Error(`${path}.text must be a non-empty string`);
      }
    } else if (obj.text !== undefined && (typeof obj.text !== "string" || obj.text.length < 1)) {
      throw new Error(`${path}.text must be a non-empty string when provided`);
    }
    return obj;
  }
  return validateAgentTurnPayload(obj, path, patch);
}

function validateStatePatch(value: unknown, path: string): JsonObject {
  const obj = expectObject(value, path);
  assertAllowedKeys(obj, path, [
    "nextRunAtMs",
    "runningAtMs",
    "lastRunAtMs",
    "lastRunStatus",
    "lastStatus",
    "lastError",
    "lastErrorReason",
    "lastDurationMs",
    "consecutiveErrors",
    "lastDelivered",
    "lastDeliveryStatus",
    "lastDeliveryError",
    "lastFailureAlertAtMs"
  ]);
  readOptionalInteger(obj, "nextRunAtMs", path, 0);
  readOptionalInteger(obj, "runningAtMs", path, 0);
  readOptionalInteger(obj, "lastRunAtMs", path, 0);
  readOptionalEnum(obj, "lastRunStatus", path, CRON_STATUS_VALUES);
  readOptionalEnum(obj, "lastStatus", path, CRON_STATUS_VALUES);
  readOptionalString(obj, "lastError", path);
  readOptionalEnum(obj, "lastErrorReason", path, [
    "auth",
    "format",
    "rate_limit",
    "billing",
    "timeout",
    "model_not_found",
    "unknown"
  ]);
  readOptionalInteger(obj, "lastDurationMs", path, 0);
  readOptionalInteger(obj, "consecutiveErrors", path, 0);
  readOptionalBoolean(obj, "lastDelivered", path);
  readOptionalEnum(obj, "lastDeliveryStatus", path, DELIVERY_STATUS_VALUES);
  readOptionalString(obj, "lastDeliveryError", path);
  readOptionalInteger(obj, "lastFailureAlertAtMs", path, 0);
  return obj;
}

function validateCronListParams(value: unknown): JsonObject {
  const obj = expectObject(value, "arguments");
  assertAllowedKeys(obj, "arguments", ["includeDisabled", "limit", "offset", "query", "enabled", "sortBy", "sortDir"]);
  readOptionalBoolean(obj, "includeDisabled", "arguments");
  readOptionalInteger(obj, "limit", "arguments", 1, 200);
  readOptionalInteger(obj, "offset", "arguments", 0);
  readOptionalString(obj, "query", "arguments");
  readOptionalEnum(obj, "enabled", "arguments", ["all", "enabled", "disabled"]);
  readOptionalEnum(obj, "sortBy", "arguments", ["nextRunAtMs", "updatedAtMs", "name"]);
  readOptionalEnum(obj, "sortDir", "arguments", ["asc", "desc"]);
  return obj;
}

function validateCronStatusParams(value: unknown): JsonObject {
  const obj = expectObject(value, "arguments");
  assertAllowedKeys(obj, "arguments", []);
  return obj;
}

function validateCronAddParams(value: unknown): JsonObject {
  const obj = expectObject(value, "arguments");
  assertAllowedKeys(obj, "arguments", [
    "name",
    "description",
    "enabled",
    "deleteAfterRun",
    "agentId",
    "sessionKey",
    "schedule",
    "sessionTarget",
    "wakeMode",
    "payload",
    "delivery",
    "failureAlert"
  ]);

  if (typeof obj.name !== "string" || obj.name.length < 1) {
    throw new Error("arguments.name must be a non-empty string");
  }
  readOptionalString(obj, "description", "arguments");
  readOptionalBoolean(obj, "enabled", "arguments");
  readOptionalBoolean(obj, "deleteAfterRun", "arguments");
  readOptionalNullableNonEmptyString(obj, "agentId", "arguments");
  readOptionalNullableNonEmptyString(obj, "sessionKey", "arguments");
  if (obj.schedule === undefined) {
    throw new Error("arguments.schedule is required");
  }
  validateSchedule(obj.schedule, "arguments.schedule");
  if (obj.sessionTarget === undefined) {
    throw new Error("arguments.sessionTarget is required");
  }
  validateSessionTarget(obj.sessionTarget, "arguments.sessionTarget");
  if (obj.wakeMode === undefined) {
    throw new Error("arguments.wakeMode is required");
  }
  readOptionalEnum(obj, "wakeMode", "arguments", ["next-heartbeat", "now"]);
  if (obj.payload === undefined) {
    throw new Error("arguments.payload is required");
  }
  validatePayload(obj.payload, "arguments.payload", false);
  if (obj.delivery !== undefined) {
    validateDelivery(obj.delivery, "arguments.delivery", false);
  }
  if (obj.failureAlert !== undefined) {
    validateFailureAlert(obj.failureAlert, "arguments.failureAlert");
  }
  return obj;
}

function validateCronUpdateParams(value: unknown): JsonObject {
  const obj = expectObject(value, "arguments");
  assertAllowedKeys(obj, "arguments", ["id", "jobId", "patch"]);
  const hasId = typeof obj.id === "string" && obj.id.length > 0;
  const hasJobId = typeof obj.jobId === "string" && obj.jobId.length > 0;
  if (hasId === hasJobId) {
    throw new Error("arguments must contain exactly one of id or jobId");
  }
  if (obj.patch === undefined) {
    throw new Error("arguments.patch is required");
  }
  const patch = expectObject(obj.patch, "arguments.patch");
  assertAllowedKeys(patch, "arguments.patch", [
    "name",
    "description",
    "enabled",
    "deleteAfterRun",
    "agentId",
    "sessionKey",
    "schedule",
    "sessionTarget",
    "wakeMode",
    "payload",
    "delivery",
    "failureAlert",
    "state"
  ]);
  readOptionalString(patch, "name", "arguments.patch");
  if (patch.name !== undefined && typeof patch.name === "string" && patch.name.length < 1) {
    throw new Error("arguments.patch.name must be a non-empty string");
  }
  readOptionalString(patch, "description", "arguments.patch");
  readOptionalBoolean(patch, "enabled", "arguments.patch");
  readOptionalBoolean(patch, "deleteAfterRun", "arguments.patch");
  readOptionalNullableNonEmptyString(patch, "agentId", "arguments.patch");
  readOptionalNullableNonEmptyString(patch, "sessionKey", "arguments.patch");
  if (patch.schedule !== undefined) {
    validateSchedule(patch.schedule, "arguments.patch.schedule");
  }
  if (patch.sessionTarget !== undefined) {
    validateSessionTarget(patch.sessionTarget, "arguments.patch.sessionTarget");
  }
  readOptionalEnum(patch, "wakeMode", "arguments.patch", ["next-heartbeat", "now"]);
  if (patch.payload !== undefined) {
    validatePayload(patch.payload, "arguments.patch.payload", true);
  }
  if (patch.delivery !== undefined) {
    validateDelivery(patch.delivery, "arguments.patch.delivery", true);
  }
  if (patch.failureAlert !== undefined) {
    validateFailureAlert(patch.failureAlert, "arguments.patch.failureAlert");
  }
  if (patch.state !== undefined) {
    validateStatePatch(patch.state, "arguments.patch.state");
  }
  return obj;
}

function validateCronRemoveParams(value: unknown): JsonObject {
  const obj = expectObject(value, "arguments");
  assertAllowedKeys(obj, "arguments", ["id", "jobId"]);
  const hasId = typeof obj.id === "string" && obj.id.length > 0;
  const hasJobId = typeof obj.jobId === "string" && obj.jobId.length > 0;
  if (hasId === hasJobId) {
    throw new Error("arguments must contain exactly one of id or jobId");
  }
  return obj;
}

function validateCronRunParams(value: unknown): JsonObject {
  const obj = expectObject(value, "arguments");
  assertAllowedKeys(obj, "arguments", ["id", "jobId", "mode"]);
  const hasId = typeof obj.id === "string" && obj.id.length > 0;
  const hasJobId = typeof obj.jobId === "string" && obj.jobId.length > 0;
  if (hasId === hasJobId) {
    throw new Error("arguments must contain exactly one of id or jobId");
  }
  readOptionalEnum(obj, "mode", "arguments", ["due", "force"]);
  return obj;
}

function validateCronRunsParams(value: unknown): JsonObject {
  const obj = expectObject(value, "arguments");
  assertAllowedKeys(obj, "arguments", [
    "scope",
    "id",
    "jobId",
    "limit",
    "offset",
    "statuses",
    "status",
    "deliveryStatuses",
    "deliveryStatus",
    "query",
    "sortDir"
  ]);
  readOptionalEnum(obj, "scope", "arguments", ["job", "all"]);
  readOptionalString(obj, "id", "arguments");
  if (obj.id !== undefined && typeof obj.id === "string" && obj.id.length < 1) {
    throw new Error("arguments.id must be a non-empty string");
  }
  readOptionalString(obj, "jobId", "arguments");
  if (obj.jobId !== undefined && typeof obj.jobId === "string" && obj.jobId.length < 1) {
    throw new Error("arguments.jobId must be a non-empty string");
  }
  readOptionalInteger(obj, "limit", "arguments", 1, 200);
  readOptionalInteger(obj, "offset", "arguments", 0);
  readOptionalStringArray(obj, "statuses", "arguments", 1, 3);
  if (Array.isArray(obj.statuses)) {
    for (const status of obj.statuses) {
      if (!(CRON_STATUS_VALUES as readonly string[]).includes(status)) {
        throw new Error(`arguments.statuses contains invalid value: ${status}`);
      }
    }
  }
  readOptionalEnum(obj, "status", "arguments", ["all", "ok", "error", "skipped"]);
  readOptionalStringArray(obj, "deliveryStatuses", "arguments", 1, 4);
  if (Array.isArray(obj.deliveryStatuses)) {
    for (const status of obj.deliveryStatuses) {
      if (!(DELIVERY_STATUS_VALUES as readonly string[]).includes(status)) {
        throw new Error(`arguments.deliveryStatuses contains invalid value: ${status}`);
      }
    }
  }
  readOptionalEnum(obj, "deliveryStatus", "arguments", DELIVERY_STATUS_VALUES);
  readOptionalString(obj, "query", "arguments");
  readOptionalEnum(obj, "sortDir", "arguments", ["asc", "desc"]);
  return obj;
}

export function validateCronToolArguments(toolName: CronToolName, rawArguments: unknown): JsonObject {
  const args = rawArguments ?? {};
  switch (toolName) {
    case "openclaw_cron_status":
      return validateCronStatusParams(args);
    case "openclaw_cron_list":
      return validateCronListParams(args);
    case "openclaw_cron_add":
      return validateCronAddParams(args);
    case "openclaw_cron_update":
      return validateCronUpdateParams(args);
    case "openclaw_cron_remove":
      return validateCronRemoveParams(args);
    case "openclaw_cron_run":
      return validateCronRunParams(args);
    case "openclaw_cron_runs":
      return validateCronRunsParams(args);
  }
}

const stringSchema = { type: "string" } as const;
const nonEmptyStringSchema = { type: "string", minLength: 1 } as const;
const boolSchema = { type: "boolean" } as const;
const integerSchema = (minimum?: number, maximum?: number) => ({
  type: "integer",
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {})
});
const numberSchema = (minimum?: number) => ({
  type: "number",
  ...(minimum !== undefined ? { minimum } : {})
});
const stringArraySchema = (minItems?: number, maxItems?: number) => ({
  type: "array",
  items: stringSchema,
  ...(minItems !== undefined ? { minItems } : {}),
  ...(maxItems !== undefined ? { maxItems } : {})
});

const scheduleSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "at" },
        at: nonEmptyStringSchema
      },
      required: ["kind", "at"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        kind: { const: "every" },
        everyMs: integerSchema(1),
        anchorMs: integerSchema(0)
      },
      required: ["kind", "everyMs"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        kind: { const: "cron" },
        expr: nonEmptyStringSchema,
        tz: stringSchema,
        staggerMs: integerSchema(0)
      },
      required: ["kind", "expr"],
      additionalProperties: false
    }
  ]
} as const;

const failureDestinationSchema = {
  type: "object",
  properties: {
    channel: { anyOf: [{ const: "last" }, nonEmptyStringSchema] },
    to: stringSchema,
    accountId: nonEmptyStringSchema,
    mode: { enum: ["announce", "webhook"] }
  },
  additionalProperties: false
} as const;

const deliverySchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        mode: { const: "none" },
        to: stringSchema,
        channel: { anyOf: [{ const: "last" }, nonEmptyStringSchema] },
        accountId: nonEmptyStringSchema,
        bestEffort: boolSchema,
        failureDestination: failureDestinationSchema
      },
      required: ["mode"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        mode: { const: "announce" },
        to: stringSchema,
        channel: { anyOf: [{ const: "last" }, nonEmptyStringSchema] },
        accountId: nonEmptyStringSchema,
        bestEffort: boolSchema,
        failureDestination: failureDestinationSchema
      },
      required: ["mode"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        mode: { const: "webhook" },
        to: nonEmptyStringSchema,
        channel: { anyOf: [{ const: "last" }, nonEmptyStringSchema] },
        accountId: nonEmptyStringSchema,
        bestEffort: boolSchema,
        failureDestination: failureDestinationSchema
      },
      required: ["mode", "to"],
      additionalProperties: false
    }
  ]
} as const;

const deliveryPatchSchema = {
  type: "object",
  properties: {
    mode: { enum: ["none", "announce", "webhook"] },
    to: stringSchema,
    channel: { anyOf: [{ const: "last" }, nonEmptyStringSchema] },
    accountId: nonEmptyStringSchema,
    bestEffort: boolSchema,
    failureDestination: failureDestinationSchema
  },
  additionalProperties: false
} as const;

const failureAlertSchema = {
  oneOf: [
    { const: false },
    {
      type: "object",
      properties: {
        after: integerSchema(1),
        channel: { anyOf: [{ const: "last" }, nonEmptyStringSchema] },
        to: stringSchema,
        cooldownMs: integerSchema(0),
        mode: { enum: ["announce", "webhook"] },
        accountId: nonEmptyStringSchema
      },
      additionalProperties: false
    }
  ]
} as const;

const payloadSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "systemEvent" },
        text: nonEmptyStringSchema
      },
      required: ["kind", "text"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        kind: { const: "agentTurn" },
        message: nonEmptyStringSchema,
        model: stringSchema,
        fallbacks: stringArraySchema(),
        thinking: stringSchema,
        timeoutSeconds: numberSchema(0),
        allowUnsafeExternalContent: boolSchema,
        lightContext: boolSchema,
        toolsAllow: stringArraySchema()
      },
      required: ["kind", "message"],
      additionalProperties: false
    }
  ]
} as const;

const payloadPatchSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "systemEvent" },
        text: nonEmptyStringSchema
      },
      required: ["kind"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        kind: { const: "agentTurn" },
        message: nonEmptyStringSchema,
        model: stringSchema,
        fallbacks: stringArraySchema(),
        thinking: stringSchema,
        timeoutSeconds: numberSchema(0),
        allowUnsafeExternalContent: boolSchema,
        lightContext: boolSchema,
        toolsAllow: {
          anyOf: [stringArraySchema(), { type: "null" }]
        }
      },
      required: ["kind"],
      additionalProperties: false
    }
  ]
} as const;

const cronStatePatchSchema = {
  type: "object",
  properties: {
    nextRunAtMs: integerSchema(0),
    runningAtMs: integerSchema(0),
    lastRunAtMs: integerSchema(0),
    lastRunStatus: { enum: [...CRON_STATUS_VALUES] },
    lastStatus: { enum: [...CRON_STATUS_VALUES] },
    lastError: stringSchema,
    lastErrorReason: { enum: ["auth", "format", "rate_limit", "billing", "timeout", "model_not_found", "unknown"] },
    lastDurationMs: integerSchema(0),
    consecutiveErrors: integerSchema(0),
    lastDelivered: boolSchema,
    lastDeliveryStatus: { enum: [...DELIVERY_STATUS_VALUES] },
    lastDeliveryError: stringSchema,
    lastFailureAlertAtMs: integerSchema(0)
  },
  additionalProperties: false
} as const;

export const CRON_TOOL_INPUT_SCHEMAS: Record<
  CronToolName,
  {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: false;
    required?: string[];
    oneOf?: Array<Record<string, unknown>>;
  }
> = {
  openclaw_cron_status: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  openclaw_cron_list: {
    type: "object",
    properties: {
      includeDisabled: boolSchema,
      limit: integerSchema(1, 200),
      offset: integerSchema(0),
      query: stringSchema,
      enabled: { enum: ["all", "enabled", "disabled"] },
      sortBy: { enum: ["nextRunAtMs", "updatedAtMs", "name"] },
      sortDir: { enum: ["asc", "desc"] }
    },
    additionalProperties: false
  },
  openclaw_cron_add: {
    type: "object",
    properties: {
      name: nonEmptyStringSchema,
      description: stringSchema,
      enabled: boolSchema,
      deleteAfterRun: boolSchema,
      agentId: { anyOf: [nonEmptyStringSchema, { type: "null" }] },
      sessionKey: { anyOf: [nonEmptyStringSchema, { type: "null" }] },
      schedule: scheduleSchema,
      sessionTarget: { anyOf: [{ enum: ["main", "isolated", "current"] }, { type: "string", pattern: "^session:.+" }] },
      wakeMode: { enum: ["next-heartbeat", "now"] },
      payload: payloadSchema,
      delivery: deliverySchema,
      failureAlert: failureAlertSchema
    },
    required: ["name", "schedule", "sessionTarget", "wakeMode", "payload"],
    additionalProperties: false
  },
  openclaw_cron_update: {
    type: "object",
    properties: {
      id: nonEmptyStringSchema,
      jobId: nonEmptyStringSchema,
      patch: {
        type: "object",
        properties: {
          name: nonEmptyStringSchema,
          description: stringSchema,
          enabled: boolSchema,
          deleteAfterRun: boolSchema,
          agentId: { anyOf: [nonEmptyStringSchema, { type: "null" }] },
          sessionKey: { anyOf: [nonEmptyStringSchema, { type: "null" }] },
          schedule: scheduleSchema,
          sessionTarget: {
            anyOf: [{ enum: ["main", "isolated", "current"] }, { type: "string", pattern: "^session:.+" }]
          },
          wakeMode: { enum: ["next-heartbeat", "now"] },
          payload: payloadPatchSchema,
          delivery: deliveryPatchSchema,
          failureAlert: failureAlertSchema,
          state: cronStatePatchSchema
        },
        additionalProperties: false
      }
    },
    required: ["patch"],
    oneOf: [{ required: ["id"] }, { required: ["jobId"] }],
    additionalProperties: false
  },
  openclaw_cron_remove: {
    type: "object",
    properties: {
      id: nonEmptyStringSchema,
      jobId: nonEmptyStringSchema
    },
    oneOf: [{ required: ["id"] }, { required: ["jobId"] }],
    additionalProperties: false
  },
  openclaw_cron_run: {
    type: "object",
    properties: {
      id: nonEmptyStringSchema,
      jobId: nonEmptyStringSchema,
      mode: { enum: ["due", "force"] }
    },
    oneOf: [{ required: ["id"] }, { required: ["jobId"] }],
    additionalProperties: false
  },
  openclaw_cron_runs: {
    type: "object",
    properties: {
      scope: { enum: ["job", "all"] },
      id: nonEmptyStringSchema,
      jobId: nonEmptyStringSchema,
      limit: integerSchema(1, 200),
      offset: integerSchema(0),
      statuses: stringArraySchema(1, 3),
      status: { enum: ["all", "ok", "error", "skipped"] },
      deliveryStatuses: stringArraySchema(1, 4),
      deliveryStatus: { enum: [...DELIVERY_STATUS_VALUES] },
      query: stringSchema,
      sortDir: { enum: ["asc", "desc"] }
    },
    additionalProperties: false
  }
};
