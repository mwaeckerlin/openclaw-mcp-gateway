import { ALLOWED_GATEWAY_OPERATIONS, AllowedToolName } from "./commands.js";

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
    description: ALLOWED_GATEWAY_OPERATIONS.openclaw_status.description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "openclaw_gateway_status",
    description: ALLOWED_GATEWAY_OPERATIONS.openclaw_gateway_status.description,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];
