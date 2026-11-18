import { join } from "node:path";
import { seedDesired, transferDesired } from "@unverse/core";
import {
  type FlagSpec,
  manifestFile,
  mappingFile,
  policyFile,
} from "./commands.js";
import { readDocument, readMapping } from "./documents.js";
import type { Pipeline, PipelineContext } from "./pipeline.js";

const seedName = /^[\w][\w.-]*$/;

export function seedPath(root: string, value: string): string {
  return seedName.test(value) && !value.endsWith(".json")
    ? join(root, ".unverse", "seeds", `${value}.json`)
    : value;
}

const onExistingFlag: FlagSpec = {
  name: "--on-existing",
  value: "block|update",
  choices: ["block", "update"],
  summary:
    "What to do with a target row that differs: block the plan (default) or update the differing fields.",
};

const onExisting = (params: PipelineContext["params"]) =>
  params["on-existing"] === undefined
    ? {}
    : { onExisting: params["on-existing"] as "block" | "update" };

const seedFlag: FlagSpec = {
  name: "--seed",
  value: "name|path",
  summary:
    "Read a seed: a name resolves to .unverse/seeds/<name>.json, anything else is a file path.",
  required: true,
};

export function builtinPipelines(
  readFile: (path: string) => Promise<string>,
  root: string,
): Readonly<Record<string, Pipeline>> {
  const readSeed = async (context: PipelineContext) =>
    seedDesired(
      await readDocument(readFile, seedPath(root, String(context.params.seed))),
    );
  return {
    seed: {
      description:
        "Plan deterministic fixture rows from a versioned declarative seed with keyed rows; existing rows block or update.",
      params: [seedFlag, onExistingFlag],
      run: async (context) => ({
        ...(await readSeed(context)),
        ...onExisting(context.params),
      }),
    },
    purge: {
      description:
        "Plan the deletion of exactly the rows a seed derives, children first; apply requires --destructive.",
      params: [seedFlag],
      run: async (context) => ({ ...(await readSeed(context)), purge: true }),
    },
    transfer: {
      description:
        "Plan a policy-filtered Dataverse-to-Dataverse transfer from an export; existing rows block or update.",
      params: [mappingFile, manifestFile, policyFile, onExistingFlag],
      run: async (context) => ({
        ...(await transferDesired(
          await readDocument(readFile, String(context.params["manifest-file"])),
          JSON.parse(await readFile(String(context.params["policy-file"]))),
          await readMapping(readFile, String(context.params["mapping-file"])),
        )),
        ...onExisting(context.params),
      }),
    },
  };
}
