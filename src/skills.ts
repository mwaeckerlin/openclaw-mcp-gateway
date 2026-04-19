type JsonObject = Record<string, unknown>;

export type SkillsToolName = "openclaw_skills_list" | "openclaw_skills_detail";

export interface SkillsRpcOperation {
  method: "skills.status";
  timeoutMs: number;
  description: string;
}

const SKILLS_TOOL_NAMES: SkillsToolName[] = ["openclaw_skills_list", "openclaw_skills_detail"];

export const SKILLS_RPC_OPERATIONS: Record<SkillsToolName, SkillsRpcOperation> = {
  openclaw_skills_list: {
    method: "skills.status",
    timeoutMs: 15_000,
    description: "List visible OpenClaw skills with safe metadata only."
  },
  openclaw_skills_detail: {
    method: "skills.status",
    timeoutMs: 15_000,
    description: "Read safe details for one visible OpenClaw skill."
  }
};

const SKILL_SAFE_FIELDS = [
  "name",
  "description",
  "skillKey",
  "source",
  "bundled",
  "eligible",
  "disabled",
  "blockedByAllowlist",
  "emoji",
  "homepage"
] as const;

const INSTALL_SAFE_FIELDS = ["id", "kind", "label", "bins"] as const;

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

function readOptionalBoolean(value: JsonObject, key: string, path: string): boolean | undefined {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw new Error(`${path}.${key} must be a boolean`);
  }
  return raw;
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

function sanitizeStringArray(value: unknown, maxItems = 50): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value.filter((entry) => typeof entry === "string") as string[];
  return result.length > 0 ? result.slice(0, maxItems) : undefined;
}

function sanitizeInstallOptions(value: unknown): JsonObject[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .map((entry) => {
      if (!isObject(entry)) {
        return undefined;
      }
      const safe = pickSafeFields(entry, INSTALL_SAFE_FIELDS);
      const bins = sanitizeStringArray(entry.bins, 20);
      if (bins) {
        safe.bins = bins;
      }
      return Object.keys(safe).length > 0 ? safe : undefined;
    })
    .filter((entry): entry is JsonObject => Boolean(entry));

  return entries.length > 0 ? entries : undefined;
}

function sanitizeRequirementObject(value: unknown): JsonObject | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const output: JsonObject = {};
  for (const key of ["bins", "anyBins", "env", "config", "os"] as const) {
    const sanitized = sanitizeStringArray(value[key], 50);
    if (sanitized) {
      output[key] = sanitized;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function sanitizeConfigChecks(value: unknown): JsonObject[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const checks = value
    .map((entry) => {
      if (!isObject(entry)) {
        return undefined;
      }
      const safe = pickSafeFields(entry, ["key", "status", "message"]);
      return Object.keys(safe).length > 0 ? safe : undefined;
    })
    .filter((entry): entry is JsonObject => Boolean(entry));

  return checks.length > 0 ? checks : undefined;
}

function sanitizeSkill(value: unknown): JsonObject | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const skill = pickSafeFields(value, SKILL_SAFE_FIELDS);

  const requirements = sanitizeRequirementObject(value.requirements);
  if (requirements) {
    skill.requirements = requirements;
  }

  const missing = sanitizeRequirementObject(value.missing);
  if (missing) {
    skill.missing = missing;
  }

  const configChecks = sanitizeConfigChecks(value.configChecks);
  if (configChecks) {
    skill.configChecks = configChecks;
  }

  const install = sanitizeInstallOptions(value.install);
  if (install) {
    skill.install = install;
  }

  return Object.keys(skill).length > 0 ? skill : undefined;
}

function normalizePagingInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  if (value < minimum) {
    return minimum;
  }
  if (value > maximum) {
    return maximum;
  }
  return value;
}

export function isSkillsToolName(value: string): value is SkillsToolName {
  return SKILLS_TOOL_NAMES.includes(value as SkillsToolName);
}

function validateSkillsListArguments(rawArguments: unknown): JsonObject {
  const args = expectObject(rawArguments ?? {}, "arguments");
  assertAllowedKeys(args, "arguments", ["agentId", "limit", "offset", "eligible", "query"]);
  readOptionalString(args, "agentId", "arguments", 1);
  readOptionalInteger(args, "limit", "arguments", 1, 100);
  readOptionalInteger(args, "offset", "arguments", 0, 1_000);
  readOptionalBoolean(args, "eligible", "arguments");
  readOptionalString(args, "query", "arguments", 1);
  return args;
}

function validateSkillsDetailArguments(rawArguments: unknown): JsonObject {
  const args = expectObject(rawArguments ?? {}, "arguments");
  assertAllowedKeys(args, "arguments", ["agentId", "skillKey", "name"]);

  readOptionalString(args, "agentId", "arguments", 1);
  const skillKey = readOptionalString(args, "skillKey", "arguments", 1);
  const name = readOptionalString(args, "name", "arguments", 1);

  if ((skillKey ? 1 : 0) + (name ? 1 : 0) !== 1) {
    throw new Error("arguments must contain exactly one of skillKey or name");
  }

  return args;
}

export function validateSkillsToolArguments(toolName: SkillsToolName, rawArguments: unknown): JsonObject {
  switch (toolName) {
    case "openclaw_skills_list":
      return validateSkillsListArguments(rawArguments);
    case "openclaw_skills_detail":
      return validateSkillsDetailArguments(rawArguments);
  }
}

export function buildSkillsRpcParams(toolName: SkillsToolName, validatedArguments: JsonObject): JsonObject {
  if (toolName === "openclaw_skills_list" || toolName === "openclaw_skills_detail") {
    const params: JsonObject = {};
    if (typeof validatedArguments.agentId === "string") {
      params.agentId = validatedArguments.agentId;
    }
    return params;
  }

  return {};
}

function readSkillsFromPayload(payload: unknown): JsonObject[] {
  if (!isObject(payload) || !Array.isArray(payload.skills)) {
    return [];
  }

  return payload.skills
    .map((entry) => sanitizeSkill(entry))
    .filter((entry): entry is JsonObject => Boolean(entry));
}

export function shapeSkillsToolResponse(
  toolName: SkillsToolName,
  payload: unknown,
  validatedArguments: JsonObject
): string {
  const skills = readSkillsFromPayload(payload);

  if (toolName === "openclaw_skills_list") {
    const query = typeof validatedArguments.query === "string" ? validatedArguments.query.toLowerCase() : undefined;
    const eligibleOnly = validatedArguments.eligible === true;

    const filtered = skills.filter((skill) => {
      if (eligibleOnly && skill.eligible !== true) {
        return false;
      }

      if (!query) {
        return true;
      }

      const name = typeof skill.name === "string" ? skill.name.toLowerCase() : "";
      const key = typeof skill.skillKey === "string" ? skill.skillKey.toLowerCase() : "";
      const description = typeof skill.description === "string" ? skill.description.toLowerCase() : "";
      return name.includes(query) || key.includes(query) || description.includes(query);
    });

    const limit = normalizePagingInteger(validatedArguments.limit, 25, 1, 100);
    const offset = normalizePagingInteger(validatedArguments.offset, 0, 0, 1_000);

    return JSON.stringify(
      {
        total: filtered.length,
        offset,
        limit,
        returned: filtered.slice(offset, offset + limit).length,
        skills: filtered.slice(offset, offset + limit)
      },
      null,
      2
    );
  }

  const skillKeyFilter =
    typeof validatedArguments.skillKey === "string" ? validatedArguments.skillKey.toLowerCase() : undefined;
  const nameFilter = typeof validatedArguments.name === "string" ? validatedArguments.name.toLowerCase() : undefined;

  const selected = skills.find((skill) => {
    if (skillKeyFilter && typeof skill.skillKey === "string") {
      return skill.skillKey.toLowerCase() === skillKeyFilter;
    }
    if (nameFilter && typeof skill.name === "string") {
      return skill.name.toLowerCase() === nameFilter;
    }
    return false;
  });

  if (!selected) {
    throw new Error("Requested skill is not visible");
  }

  return JSON.stringify(selected, null, 2);
}

const stringSchema = { type: "string" } as const;
const nonEmptyStringSchema = { type: "string", minLength: 1 } as const;
const boolSchema = { type: "boolean" } as const;
const integerSchema = (minimum?: number, maximum?: number) => ({
  type: "integer",
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {})
});

export const SKILLS_TOOL_INPUT_SCHEMAS: Record<
  SkillsToolName,
  {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: false;
    required?: string[];
    oneOf?: Array<Record<string, unknown>>;
  }
> = {
  openclaw_skills_list: {
    type: "object",
    properties: {
      agentId: nonEmptyStringSchema,
      limit: integerSchema(1, 100),
      offset: integerSchema(0, 1_000),
      eligible: boolSchema,
      query: nonEmptyStringSchema
    },
    additionalProperties: false
  },
  openclaw_skills_detail: {
    type: "object",
    properties: {
      agentId: nonEmptyStringSchema,
      skillKey: nonEmptyStringSchema,
      name: nonEmptyStringSchema
    },
    oneOf: [{ required: ["skillKey"] }, { required: ["name"] }],
    additionalProperties: false
  }
};
