import assert from "node:assert/strict";
import test from "node:test";
import { isToolDisabled, parseDisabledTools } from "./disabled-tools.js";
import { getToolDefinitions } from "./tools.js";

test("parseDisabledTools supports comma and whitespace separation", () => {
  const parsed = parseDisabledTools(" openclaw_status, openclaw_cron_list  openclaw_skills_list\n\topenclaw_status ");
  assert.deepEqual([...parsed].sort(), ["openclaw_cron_list", "openclaw_skills_list", "openclaw_status"]);
});

test("parseDisabledTools ignores empty entries", () => {
  const parsed = parseDisabledTools(" , ,   \n\t ");
  assert.equal(parsed.size, 0);
});

test("getToolDefinitions hides disabled tools from tools/list", () => {
  const disabled = new Set<string>(["openclaw_status", "openclaw_skills_detail"]);
  const names = new Set(getToolDefinitions(disabled).map((tool) => tool.name));
  assert.equal(names.has("openclaw_status"), false);
  assert.equal(names.has("openclaw_skills_detail"), false);
  assert.equal(names.has("openclaw_gateway_status"), true);
});

test("isToolDisabled matches exact tool names only", () => {
  const disabled = new Set<string>(["openclaw_status"]);
  assert.equal(isToolDisabled("openclaw_status", disabled), true);
  assert.equal(isToolDisabled("openclaw_status_extra", disabled), false);
});
