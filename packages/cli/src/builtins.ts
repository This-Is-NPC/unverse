import { join } from "node:path";
import { seedDesired, transferDesired } from "@unverse/core";
import { manifestFile, mappingFile, policyFile } from "./commands.js";
import { readDocument, readMapping } from "./documents.js";
import type { Pipeline } from "./pipeline.js";

const seedName = /^[\w][\w.-]*$/;

export function seedPath(root: string, value: string): string {
  return seedName.test(value) && !value.endsWith(".json")
    ? join(root, ".unverse", "seeds", `${value}.json`)
    : value;
}

export function builtinPipelines(
  readFile: (path: string) => Promise<string>,
  root: string,
): Readonly<Record<string, Pipeline>> {
  return {
    seed: {
      description:
        "Plan deterministic fixture rows from a versioned declarative seed with keyed rows.",
      params: [
        {
          name: "--seed",
          value: "name|path",
          summary:
            "Read a seed: a name resolves to .unverse/seeds/<name>.json, anything else is a file path.",
          required: true,
        },
      ],
      run: async (context) =>
        seedDesired(
          await readDocument(
            readFile,
            seedPath(root, String(context.params.seed)),
          ),
        ),
    },
    transfer: {
      description:
        "Plan a policy-filtered Dataverse-to-Dataverse create-only transfer from an export.",
      params: [mappingFile, manifestFile, policyFile],
      run: async (context) =>
        transferDesired(
          await readDocument(readFile, String(context.params["manifest-file"])),
          JSON.parse(await readFile(String(context.params["policy-file"]))),
          await readMapping(readFile, String(context.params["mapping-file"])),
        ),
    },
  };
}
