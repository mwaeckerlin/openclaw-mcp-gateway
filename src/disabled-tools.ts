export function parseDisabledTools(rawValue: string | undefined): Set<string> {
  if (!rawValue) {
    return new Set<string>();
  }

  return new Set(
    rawValue
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

export function loadDisabledToolsFromEnv(): Set<string> {
  return parseDisabledTools(process.env.DISABLE_TOOLS);
}

export function isToolDisabled(toolName: string, disabledTools: ReadonlySet<string>): boolean {
  return disabledTools.has(toolName);
}
