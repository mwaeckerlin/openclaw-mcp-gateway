import { ALLOWED_HTTP_GATEWAY_OPERATIONS, HttpToolName } from "./commands.js";
import { CRON_RPC_OPERATIONS, CRON_TOOL_INPUT_SCHEMAS, CronToolName } from "./cron.js";

export type AllowedToolName = HttpToolName | CronToolName;

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
  {
    name: "openclaw_status",
    description: ALLOWED_HTTP_GATEWAY_OPERATIONS.openclaw_status.description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
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
  }
];
