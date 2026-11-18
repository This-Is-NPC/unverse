import assert from "node:assert/strict";
import test from "node:test";
import { renderSkillCommands, specDocument } from "../dist/help.js";

test("the skill lists every command path under its effect", () => {
  const sections = new Map(
    renderSkillCommands()
      .split("### ")
      .filter(Boolean)
      .map((block) => [block.split("\n")[0], block]),
  );
  const { commands } = specDocument();
  assert.ok(commands.length > 0);
  for (const command of commands) {
    const line = new RegExp(`^- \`${command.path}[ \`]`, "m");
    for (const [effect, block] of sections)
      assert.equal(
        line.test(block),
        effect === command.effect,
        `${command.path} must appear only under ${command.effect}.`,
      );
  }
});
