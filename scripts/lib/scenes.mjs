import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildSeed,
  createManifest,
  parseModel,
} from "../../packages/core/dist/index.js";
import { seedSpec } from "../../packages/core/test/fixtures/seed.mjs";

export const scenes = [
  { name: "01-help", args: ["--help"] },
  { name: "02-config", args: ["config", "check", "--env", "dev"] },
  { name: "03-whoami", args: ["env", "whoami", "--env", "dev"] },
  { name: "04-doctor", args: ["env", "doctor", "--env", "dev"] },
  {
    name: "05-user-roles",
    args: [
      "user",
      "show",
      "--env",
      "dev",
      "--email",
      "synthetic@example.invalid",
    ],
  },
  {
    name: "06-check-role",
    args: [
      "role",
      "check",
      "--env",
      "dev",
      "--user-id",
      "00000000-0000-0000-0000-000000000001",
      "--role-id",
      "00000000-0000-0000-0000-000000000002",
    ],
  },
  {
    name: "07-tables",
    args: ["table", "list", "--env", "dev", "--search", "account"],
  },
  {
    name: "08-query",
    args: [
      "record",
      "query",
      "account",
      "--env",
      "dev",
      "--select",
      "accountid,name",
      "--order-by",
      "accountid asc",
    ],
  },
  {
    name: "09-schema-inspect",
    args: [
      "schema",
      "inspect",
      "--env",
      "dev",
      "--mapping-file",
      "mapping.json",
    ],
  },
  {
    name: "10-schema-plan",
    args: [
      "schema",
      "plan",
      "--env",
      "dev",
      "--mapping-file",
      "mapping.json",
      "--model-file",
      "schema.json",
    ],
  },
  {
    name: "11-pg-export",
    args: [
      "pg",
      "export",
      "--env",
      "dev",
      "--mapping-file",
      "transfer-mapping.json",
      "--model-file",
      "schema.json",
    ],
  },
  {
    name: "12-solutions",
    args: ["solution", "list", "--env", "dev", "--search", "fixture"],
  },
  {
    name: "13-components",
    args: [
      "solution",
      "show",
      "00000000-0000-0000-0000-000000000011",
      "--env",
      "dev",
    ],
  },
  {
    name: "14-apps",
    args: ["app", "list", "--env", "dev", "--search", "synthetic"],
  },
  { name: "15-flows", args: ["flow", "list", "--env", "dev"] },
  {
    name: "16-users",
    args: ["user", "list", "--env", "dev", "--search", "synthetic"],
  },
  { name: "17-variables", args: ["variable", "list", "--env", "dev"] },
  {
    name: "18-comparison",
    args: [
      "env",
      "compare",
      "--env",
      "dev",
      "--target-env",
      "test",
      "--component-solution",
      "CommunityFixture",
    ],
  },
  {
    name: "19-seed-plan",
    args: ["seed", "plan", "--env", "dev", "--seed-file", "seed.json"],
  },
  {
    name: "20-transfer-plan",
    args: [
      "transfer",
      "plan",
      "--env",
      "dev",
      "--mapping-file",
      "transfer-mapping.json",
      "--manifest-file",
      "transfer-source.json",
      "--policy-file",
      "policy.json",
    ],
  },
  { name: "21-connectors", args: ["connector", "list", "--env", "dev"] },
  {
    name: "22-connection-references",
    args: ["connref", "list", "--env", "dev"],
  },
  {
    name: "23-reference-inspection",
    args: [
      "connref",
      "show",
      "00000000-0000-0000-0000-000000000101",
      "--env",
      "dev",
    ],
  },
  {
    name: "24-dependencies",
    args: [
      "deps",
      "list",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
      "--direction",
      "dependent",
    ],
  },
  {
    name: "25-dependency-graph",
    args: [
      "deps",
      "graph",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
      "--depth",
      "6",
    ],
  },
  {
    name: "26-dependency-impact",
    args: [
      "deps",
      "impact",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
      "--depth",
      "6",
    ],
  },
  {
    name: "27-dependency-visual",
    args: [
      "deps",
      "graph",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
      "--depth",
      "6",
      "--format",
      "html",
    ],
    render: "html",
  },
  {
    name: "28-dependency-svg",
    args: [
      "deps",
      "graph",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
      "--depth",
      "6",
      "--format",
      "svg",
    ],
    render: "svg",
  },
  { name: "29-env-list", args: ["env", "list"] },
  { name: "30-command-help", args: ["schema", "apply", "--help"] },
];

export async function stageScenes(root, consumer) {
  cpSync(
    resolve(root, "packages/cli/test/fixtures/config.json"),
    resolve(consumer.directory, "unverse.config.json"),
  );
  cpSync(
    resolve(root, "packages/core/test/fixtures/schema.json"),
    resolve(consumer.directory, "schema.json"),
  );
  writeFileSync(
    resolve(consumer.directory, "mapping.json"),
    JSON.stringify({ prefix: "uv", solution: "UnverseFixture" }),
  );
  writeFileSync(
    resolve(consumer.directory, "transfer-mapping.json"),
    JSON.stringify({ prefix: "tx", solution: "TransferFixture" }),
  );
  const model = parseModel(
    JSON.parse(
      readFileSync(
        resolve(root, "packages/core/test/fixtures/schema.json"),
        "utf8",
      ),
    ),
  );
  const data = JSON.parse(
    readFileSync(
      resolve(root, "packages/core/test/fixtures/data.json"),
      "utf8",
    ),
  );
  const seed = seedSpec(
    model,
    { prefix: "tx", solution: "TransferFixture" },
    data,
  );
  writeFileSync(resolve(consumer.directory, "seed.json"), JSON.stringify(seed));
  const generated = await buildSeed(seed);
  writeFileSync(
    resolve(consumer.directory, "seed-data.json"),
    JSON.stringify(generated.data),
  );
  const manifest = await createManifest(
    model,
    data,
    {
      name: "source",
      url: "https://synthetic-source.crm.dynamics.com",
      organizationId: "synthetic-source",
    },
    { prefix: "tx", solution: "TransferFixture" },
  );
  writeFileSync(
    resolve(consumer.directory, "transfer-source.json"),
    JSON.stringify(manifest),
  );
  const fields = Object.fromEntries(
    model.entities.flatMap((entity) =>
      entity.columns
        .filter(
          (column) =>
            column.name !== entity.primaryKey &&
            column.references === undefined,
        )
        .map((column) => [`${entity.name}.${column.name}`, { action: "copy" }]),
    ),
  );
  writeFileSync(
    resolve(consumer.directory, "policy.json"),
    JSON.stringify({ policyVersion: 1, fields }),
  );
  return {
    ...process.env,
    NODE_OPTIONS: `--import=${pathToFileURL(resolve(root, "packages/cli/test/fixtures/installed.mjs")).href}`,
    FIXTURE_TENANT: "00000000-0000-0000-0000-000000000001",
    FIXTURE_CLIENT: "00000000-0000-0000-0000-000000000002",
    FIXTURE_SECRET: "synthetic-not-a-real-secret",
  };
}

export async function startBrowser(root) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(root, ".cache/playwright");
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}
