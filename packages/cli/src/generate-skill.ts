import { readFile, writeFile } from "node:fs/promises";

import { renderSkillCommands } from "./help.js";

const file = "skills/unverse/SKILL.md";
const begin = "<!-- BEGIN GENERATED COMMANDS: mise run skill -->";
const end = "<!-- END GENERATED COMMANDS -->";

const current = await readFile(file, "utf8");
const start = current.indexOf(begin);
const stop = current.indexOf(end);
if (start === -1 || stop < start) {
  throw new Error(`${file} lacks the generated-section markers.`);
}
const document = `${current.slice(0, start + begin.length)}\n\n${renderSkillCommands()}\n\n${current.slice(stop)}`;
if (process.argv.includes("--stdout")) {
  process.stdout.write(document);
} else {
  await writeFile(file, document, "utf8");
}
