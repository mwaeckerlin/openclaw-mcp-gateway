import { ALLOWED_COMMANDS, AllowedToolName } from "./commands.js";

export interface ToolDefinition {
  name: AllowedToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, never>;
    additionalProperties: false;
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "openclaw_status",
    description: ALLOWED_COMMANDS.openclaw_status.description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "openclaw_gateway_status",
    description: ALLOWED_COMMANDS.openclaw_gateway_status.description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "openclaw_logs",
    description: ALLOWED_COMMANDS.openclaw_logs.description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];
