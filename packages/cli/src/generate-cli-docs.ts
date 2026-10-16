import { writeFile } from "node:fs/promises";

import { renderCliReference } from "./commands.js";

const document = renderCliReference();
if (process.argv.includes("--stdout")) {
  process.stdout.write(document);
} else {
  await writeFile("docs/cli.md", document, "utf8");
}
