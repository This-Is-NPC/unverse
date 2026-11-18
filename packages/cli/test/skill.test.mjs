import assert from "node:assert/strict";
import test from "node:test";
import { renderSkillCommands, specDocument } from "../dist/help.js";

test("the skill lists every command path with its effect", () => {
  const section = renderSkillCommands();
  const { commands } = specDocument();
  assert.ok(commands.length > 0);
  for (const command of commands) {
    assert.ok(
      section.includes(`- \`${command.path}\` (effect: ${command.effect}):`),
      `${command.path} is missing or has the wrong effect.`,
    );
  }
});
