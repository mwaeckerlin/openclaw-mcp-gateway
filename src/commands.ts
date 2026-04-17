export type AllowedToolName =
  | "openclaw_status"
  | "openclaw_gateway_status"
  | "openclaw_logs";

export interface AllowedCommand {
  binary: string;
  args: string[];
  timeoutMs: number;
  description: string;
}

export const ALLOWED_COMMANDS: Record<AllowedToolName, AllowedCommand> = {
  openclaw_status: {
    binary: "openclaw",
    args: ["status"],
    timeoutMs: 12_000,
    description: "Return overall OpenClaw status."
  },
  openclaw_gateway_status: {
    binary: "openclaw",
    args: ["gateway", "status"],
    timeoutMs: 12_000,
    description: "Return OpenClaw gateway status."
  },
  openclaw_logs: {
    binary: "openclaw",
    args: ["logs", "--tail", "200"],
    timeoutMs: 18_000,
    description: "Return last 200 lines of OpenClaw logs."
  }
};

export function isAllowedToolName(value: string): value is AllowedToolName {
  return Object.hasOwn(ALLOWED_COMMANDS, value);
}
