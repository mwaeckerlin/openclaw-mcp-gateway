import assert from "node:assert/strict";
import test from "node:test";
import { shapeSkillsToolResponse, validateSkillsToolArguments } from "./skills.js";

test("skills list validation enforces bounded paging", () => {
  const args = validateSkillsToolArguments("openclaw_skills_list", {
    limit: 20,
    offset: 5,
    eligible: true,
    query: "calendar"
  });
  assert.deepEqual(args, { limit: 20, offset: 5, eligible: true, query: "calendar" });
});

test("skills detail validation requires exactly one selector", () => {
  assert.throws(
    () => validateSkillsToolArguments("openclaw_skills_detail", { skillKey: "weather", name: "weather" }),
    /exactly one of skillKey or name/i
  );
});

test("skills list response is curated and strips raw path metadata", () => {
  const text = shapeSkillsToolResponse(
    "openclaw_skills_list",
    {
      skills: [
        {
          name: "weather",
          description: "Weather skill",
          skillKey: "weather",
          source: "openclaw-bundled",
          bundled: true,
          eligible: true,
          filePath: "/secret/path/SKILL.md",
          requirements: { bins: ["curl"] },
          install: [{ id: "brew", kind: "brew", label: "Install", command: "brew install weather" }]
        }
      ]
    },
    { limit: 10, offset: 0 }
  );

  const parsed = JSON.parse(text);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.skills[0].name, "weather");
  assert.equal(Object.hasOwn(parsed.skills[0], "filePath"), false);
  assert.equal(Object.hasOwn(parsed.skills[0].install[0], "command"), false);
});

test("skills detail returns selected visible skill", () => {
  const text = shapeSkillsToolResponse(
    "openclaw_skills_detail",
    {
      skills: [
        { name: "calendar", skillKey: "calendar", description: "Calendar", eligible: true },
        { name: "weather", skillKey: "weather", description: "Weather", eligible: true }
      ]
    },
    { skillKey: "weather" }
  );

  const parsed = JSON.parse(text);
  assert.equal(parsed.skillKey, "weather");
  assert.equal(parsed.name, "weather");
});
