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
  { name: "02-config", args: ["config", "validate", "--env", "dev"] },
  { name: "03-whoami", args: ["whoami", "--env", "dev"] },
  { name: "04-doctor", args: ["doctor", "--env", "dev"] },
  {
    name: "05-user-roles",
    args: [
      "user",
      "roles",
      "--env",
      "dev",
      "--email",
      "synthetic@example.invalid",
    ],
  },
  {
    name: "06-check-role",
    args: [
      "check",
      "role",
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
    args: ["tables", "list", "--env", "dev", "--search", "account"],
  },
  {
    name: "08-query",
    args: [
      "query",
      "--env",
      "dev",
      "--table",
      "account",
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
      "--prefix",
      "uv",
      "--solution",
      "UnverseFixture",
    ],
  },
  {
    name: "10-schema-plan",
    args: [
      "schema",
      "plan",
      "--env",
      "dev",
      "--prefix",
      "uv",
      "--solution",
      "UnverseFixture",
      "--model-file",
      "schema.json",
    ],
  },
  {
    name: "11-transfer-export",
    args: [
      "transfer",
      "export",
      "--env",
      "dev",
      "--prefix",
      "tx",
      "--solution",
      "TransferFixture",
      "--model-file",
      "schema.json",
    ],
  },
  {
    name: "12-solutions",
    args: ["solutions", "list", "--env", "dev", "--search", "fixture"],
  },
  {
    name: "13-components",
    args: [
      "solution",
      "components",
      "--env",
      "dev",
      "--solution-id",
      "00000000-0000-0000-0000-000000000011",
    ],
  },
  {
    name: "14-apps",
    args: ["apps", "list", "--env", "dev", "--search", "synthetic"],
  },
  { name: "15-flows", args: ["flows", "list", "--env", "dev"] },
  {
    name: "16-users",
    args: ["users", "list", "--env", "dev", "--search", "synthetic"],
  },
  { name: "17-variables", args: ["variables", "list", "--env", "dev"] },
  {
    name: "18-comparison",
    args: [
      "environment",
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
      "--prefix",
      "tx",
      "--solution",
      "TransferFixture",
      "--manifest-file",
      "transfer-source.json",
      "--policy-file",
      "policy.json",
    ],
  },
  { name: "21-connectors", args: ["connectors", "list", "--env", "dev"] },
  {
    name: "22-connection-references",
    args: ["connection-references", "list", "--env", "dev"],
  },
  {
    name: "23-reference-inspection",
    args: [
      "connection-references",
      "inspect",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
    ],
  },
  {
    name: "24-dependencies",
    args: [
      "dependencies",
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
      "dependencies",
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
      "dependencies",
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
      "dependencies",
      "graph",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
      "--depth",
      "6",
      "--html",
    ],
    render: "html",
  },
  {
    name: "28-dependency-svg",
    args: [
      "dependencies",
      "graph",
      "--env",
      "dev",
      "--reference-id",
      "00000000-0000-0000-0000-000000000101",
      "--depth",
      "6",
      "--svg",
    ],
    render: "svg",
  },
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
