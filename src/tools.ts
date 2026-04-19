import { ALLOWED_HTTP_GATEWAY_OPERATIONS, HttpToolName } from "./commands.js";
import { CRON_RPC_OPERATIONS, CRON_TOOL_INPUT_SCHEMAS, CronToolName } from "./cron.js";
import { READONLY_RPC_TOOL_DEFINITIONS, ReadonlyRpcToolName } from "./readonly-rpc-tools.js";
import { SKILLS_RPC_OPERATIONS, SKILLS_TOOL_INPUT_SCHEMAS, SkillsToolName } from "./skills.js";

export type AllowedToolName = HttpToolName | CronToolName | SkillsToolName | ReadonlyRpcToolName;

export interface ToolDefinition {
  name: AllowedToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: false;
    required?: string[];
    oneOf?: Array<Record<string, unknown>>;
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  ...READONLY_RPC_TOOL_DEFINITIONS,
  {
    name: "openclaw_gateway_status",
    description: ALLOWED_HTTP_GATEWAY_OPERATIONS.openclaw_gateway_status.description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "openclaw_cron_status",
    description: CRON_RPC_OPERATIONS.openclaw_cron_status.description,
    inputSchema: CRON_TOOL_INPUT_SCHEMAS.openclaw_cron_status
  },
  {
    name: "openclaw_cron_list",
    description: CRON_RPC_OPERATIONS.openclaw_cron_list.description,
    inputSchema: CRON_TOOL_INPUT_SCHEMAS.openclaw_cron_list
  },
  {
    name: "openclaw_cron_add",
    description: CRON_RPC_OPERATIONS.openclaw_cron_add.description,
    inputSchema: CRON_TOOL_INPUT_SCHEMAS.openclaw_cron_add
  },
  {
    name: "openclaw_cron_update",
    description: CRON_RPC_OPERATIONS.openclaw_cron_update.description,
    inputSchema: CRON_TOOL_INPUT_SCHEMAS.openclaw_cron_update
  },
  {
    name: "openclaw_cron_remove",
    description: CRON_RPC_OPERATIONS.openclaw_cron_remove.description,
    inputSchema: CRON_TOOL_INPUT_SCHEMAS.openclaw_cron_remove
  },
  {
    name: "openclaw_cron_run",
    description: CRON_RPC_OPERATIONS.openclaw_cron_run.description,
    inputSchema: CRON_TOOL_INPUT_SCHEMAS.openclaw_cron_run
  },
  {
    name: "openclaw_cron_runs",
    description: CRON_RPC_OPERATIONS.openclaw_cron_runs.description,
    inputSchema: CRON_TOOL_INPUT_SCHEMAS.openclaw_cron_runs
  },
  {
    name: "openclaw_sessions_list",
    description: ALLOWED_HTTP_GATEWAY_OPERATIONS.openclaw_sessions_list.description,
    inputSchema: {
      type: "object",
      properties: {
        kind: { enum: ["main", "group", "cron", "hook", "node"] },
        activeMinutes: { type: "integer", minimum: 1, maximum: 10080 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0, maximum: 1000 }
      },
      additionalProperties: false
    }
  },
  {
    name: "openclaw_session_status",
    description: ALLOWED_HTTP_GATEWAY_OPERATIONS.openclaw_session_status.description,
    inputSchema: {
      type: "object",
      properties: {
        sessionKey: { type: "string", minLength: 1 },
        sessionId: { type: "string", minLength: 1 }
      },
      oneOf: [{ required: ["sessionKey"] }, { required: ["sessionId"] }],
      additionalProperties: false
    }
  },
  {
    name: "openclaw_skills_list",
    description: SKILLS_RPC_OPERATIONS.openclaw_skills_list.description,
    inputSchema: SKILLS_TOOL_INPUT_SCHEMAS.openclaw_skills_list
  },
  {
    name: "openclaw_skills_detail",
    description: SKILLS_RPC_OPERATIONS.openclaw_skills_detail.description,
    inputSchema: SKILLS_TOOL_INPUT_SCHEMAS.openclaw_skills_detail
  }
];

export function getToolDefinitions(disabledTools: ReadonlySet<string> = new Set()): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) => !disabledTools.has(tool.name));
}
