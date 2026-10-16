import assert from "node:assert/strict";
import test from "node:test";
import {
  createManifest,
  parseModel,
  preservedIdentities,
  verifyTransfer,
} from "@unverse/core";
import { DataverseError } from "@unverse/dataverse";
import transferData from "../../core/test/fixtures/data.json" with {
  type: "json",
};
import transferModel from "../../core/test/fixtures/schema.json" with {
  type: "json",
};
import {
  dependencyEnvironment,
  dependencyFixture,
  referenceId,
} from "../../dataverse/test/fixtures/dependencies.mjs";
import { queryFixture } from "../../dataverse/test/fixtures/query.mjs";
import {
  fixture,
  otherRoleId,
  roleId,
} from "../../dataverse/test/fixtures/roles.mjs";
import {
  schemaFixture,
  model as schemaModel,
} from "../../dataverse/test/fixtures/schema.mjs";
import { runCli } from "../dist/run.js";

const validConfig = JSON.stringify({
  configVersion: 1,
  environments: {
    dev: {
      url: "https://dev.crm.dynamics.com/",
      tenantIdEnv: "UNVERSE_TENANT_ID",
      clientIdEnv: "UNVERSE_CLIENT_ID",
      clientSecretEnv: "UNVERSE_CLIENT_SECRET",
    },
  },
});

test("requires an environment before reading configuration", async () => {
  let reads = 0;
  const result = await runCli(
    ["config", "validate"],
    runtime(() => {
      reads += 1;
      return validConfig;
    }),
  );
  assert.equal(result, 2);
  assert.equal(reads, 0);
});

test("reports the selected normalized environment in one JSON document", async () => {
  const output = [];
  const errors = [];
  const result = await runCli(
    ["config", "validate", "--env", "dev", "--json"],
    runtime(() => validConfig, output, errors),
  );
  assert.equal(result, 0);
  assert.deepEqual(errors, []);
  assert.equal(output.length, 1);
  const document = JSON.parse(output[0]);
  assert.equal(document.environment.url, "https://dev.crm.dynamics.com");
  assert.equal(document.status, "ok");
});

test("redacts secrets from JSON errors", async () => {
  const output = [];
  const errors = [];
  const result = await runCli(
    ["config", "validate", "--env", "dev", "--json"],
    runtime(
      () => {
        throw new Error("Unable to read top-secret");
      },
      output,
      errors,
      ["top-secret"],
    ),
  );
  assert.equal(result, 2);
  assert.deepEqual(errors, []);
  assert.doesNotMatch(output[0], /top-secret/);
  assert.match(output[0], /\[REDACTED\]/);
});

test("reports the application user returned by whoami", async () => {
  const output = [];
  const result = await runCli(
    ["whoami", "--env", "dev", "--json"],
    runtime(
      () => validConfig,
      output,
      [],
      [],
      async () => ({
        organizationId: "org",
        applicationUserId: "app",
        businessUnitId: "unit",
      }),
    ),
  );
  assert.equal(result, 0);
  assert.equal(JSON.parse(output[0]).caller.id, "app");
});

test("preserves permission failures from whoami", async () => {
  const output = [];
  const result = await runCli(
    ["whoami", "--env", "dev", "--json"],
    runtime(
      () => validConfig,
      output,
      [],
      [],
      async () => {
        throw new DataverseError("permission", "forbidden");
      },
    ),
  );
  assert.equal(result, 4);
  assert.equal(JSON.parse(output[0]).command, "whoami");
  assert.equal(JSON.parse(output[0]).environment.name, "dev");
});

test("doctor reports its limited probe coverage", async () => {
  const output = [];
  const result = await runCli(
    ["doctor", "--env", "dev", "--json"],
    runtime(
      () => validConfig,
      output,
      [],
      [],
      async () => ({
        organizationId: "org",
        applicationUserId: "app",
        businessUnitId: "unit",
      }),
    ),
  );
  assert.equal(result, 0);
  const document = JSON.parse(output[0]);
  assert.equal(document.command, "doctor");
  assert.equal(document.data.checks.length, 3);
  assert.match(document.coverage.limitations[0], /Only WhoAmI/);
});

test("invalid profiles prevent token acquisition", async () => {
  let calls = 0;
  const result = await runCli(
    ["whoami", "--env", "dev", "--json"],
    runtime(
      () => validConfig.replace('"configVersion":1', '"configVersion":2'),
      [],
      [],
      [],
      async () => {
        calls += 1;
        return {};
      },
    ),
  );
  assert.equal(calls, 0);
  assert.equal(result, 2);
});

test("doctor preserves authentication failure and skips the API probe", async () => {
  const output = [];
  const result = await runCli(
    ["doctor", "--env", "dev", "--json"],
    runtime(
      () => validConfig,
      output,
      [],
      [],
      async () => {
        throw new DataverseError("authentication", "no token");
      },
    ),
  );
  assert.equal(result, 3);
  assert.equal(JSON.parse(output[0]).data.checks[2].status, "not-run");
});

test("JSON parse errors remain JSON even when --json follows the bad option", async () => {
  const output = [];
  assert.equal(
    await runCli(
      ["whoami", "--bad", "--json"],
      runtime(() => validConfig, output),
    ),
    2,
  );
  assert.equal(JSON.parse(output[0]).status, "error");
});

function runtime(readConfig, output = [], errors = [], secrets = [], whoAmI) {
  return {
    readFile: async () => readConfig(),
    now: () => "2026-10-16T00:00:00.000Z",
    writeOut: (line) => output.push(line),
    writeError: (line) => errors.push(line),
    secrets,
    connect: () => ({ whoAmI }),
  };
}

test("failed role expectation differs from an informational empty list", async () => {
  const output = [];
  const base = {
    ...runtime(() => validConfig, output),
    connect: () => fixture({ direct: [], team: [] }).client,
  };
  const userArguments = [
    "--env",
    "dev",
    "--email",
    "synthetic@example.invalid",
    "--json",
  ];
  assert.equal(await runCli(["user", "roles", ...userArguments], base), 0);
  assert.equal(
    await runCli(
      ["check", "role", ...userArguments, "--role-id", roleId],
      base,
    ),
    1,
  );
  assert.equal(JSON.parse(output[1]).data.assigned, false);
});

test("denied team reads cannot make a missing-role check fail", async () => {
  const output = [];
  const result = await runCli(
    [
      "check",
      "role",
      "--env",
      "dev",
      "--email",
      "synthetic@example.invalid",
      "--role-id",
      otherRoleId,
      "--json",
    ],
    {
      ...runtime(() => validConfig, output),
      connect: () => fixture({ denied: true }).client,
    },
  );
  assert.equal(result, 4);
  assert.equal(JSON.parse(output[0]).status, "error");
});

test("capped CLI queries return inconclusive coverage and exit seven", async () => {
  const output = [];
  const result = await runCli(
    [
      "query",
      "--env",
      "dev",
      "--table",
      "account",
      "--select",
      "name",
      "--limit",
      "1",
      "--json",
    ],
    {
      ...runtime(() => validConfig, output),
      connect: () => queryFixture().client,
    },
  );
  assert.equal(result, 7);
  assert.equal(JSON.parse(output[0]).coverage.complete, false);
  assert.equal(JSON.parse(output[0]).data.rows.length, 1);
});

test("CLI schema planning and confirmed apply share the result contract", async () => {
  const output = [];
  const fixture = schemaFixture();
  let plan;
  const base = {
    ...runtime(() => validConfig, output),
    readFile: async (path) =>
      path === "unverse.config.json"
        ? validConfig
        : path === "model.json"
          ? JSON.stringify(schemaModel)
          : JSON.stringify(plan),
    connect: () => fixture.client,
  };
  assert.equal(
    await runCli(
      [
        "schema",
        "plan",
        "--env",
        "dev",
        "--prefix",
        "uv",
        "--solution",
        "UnverseFixture",
        "--model-file",
        "model.json",
        "--json",
      ],
      base,
    ),
    0,
  );
  plan = JSON.parse(output[0]);
  assert.equal(plan.data.provider, "dataverse");
  assert.equal(
    await runCli(
      [
        "schema",
        "apply",
        "--env",
        "dev",
        "--plan-file",
        "plan.json",
        "--confirm",
        "--json",
      ],
      base,
    ),
    0,
  );
  assert.deepEqual(JSON.parse(output[1]).data.operations, []);
});

test("CLI schema apply without confirmation does not request a token", async () => {
  let calls = 0;
  const result = await runCli(
    ["schema", "apply", "--env", "dev", "--plan-file", "plan.json", "--json"],
    {
      ...runtime(() => validConfig),
      readFile: async (path) =>
        path === "unverse.config.json" ? validConfig : "{}",
      connect: () => ({
        whoAmI: async () => {
          calls += 1;
        },
      }),
    },
  );
  assert.equal(result, 2);
  assert.equal(calls, 0);
});

test("CLI transfer import requires confirmation before connecting", async () => {
  let connections = 0;
  const result = await runCli(
    [
      "transfer",
      "import",
      "--env",
      "dev",
      "--manifest-file",
      "manifest.json",
      "--json",
    ],
    {
      ...runtime(() => validConfig),
      connectPostgres: () => {
        connections += 1;
      },
    },
  );
  assert.equal(result, 2);
  assert.equal(connections, 0);
});

test("CLI transfer verification uses PostgreSQL without requesting a Dataverse token", async () => {
  const manifest = await createManifest(
    parseModel(transferModel),
    transferData,
    {
      name: "dev",
      url: "https://dev.crm.dynamics.com",
      organizationId: "fixture",
    },
    { prefix: "uv", solution: "Fixture" },
  );
  const configuration = JSON.parse(validConfig);
  configuration.environments.dev.postgres = {
    connectionStringEnv: "UNVERSE_POSTGRES_URL",
    schema: "fixture",
  };
  const output = [];
  let closed = 0;
  let tokens = 0;
  const result = await runCli(
    [
      "transfer",
      "verify",
      "--env",
      "dev",
      "--manifest-file",
      "manifest.json",
      "--json",
    ],
    {
      ...runtime(() => validConfig, output),
      readFile: async (path) =>
        JSON.stringify(path === "manifest.json" ? manifest : configuration),
      connect: () => ({
        whoAmI: async () => {
          tokens += 1;
        },
      }),
      connectPostgres: () => ({
        verify: async () => ({
          ...verifyTransfer(
            manifest,
            transferData,
            preservedIdentities(manifest),
          ),
          target: { provider: "postgres", schema: "fixture" },
          checkpoint: "read-only",
        }),
        close: async () => {
          closed += 1;
        },
      }),
    },
  );
  assert.equal(result, 0);
  assert.equal(tokens, 0);
  assert.equal(closed, 1);
  assert.equal(JSON.parse(output[0]).data.verified, true);
});

test("CLI role convenience resolves the authenticated caller", async () => {
  const { client, calls } = fixture();
  client.whoAmI = async () => ({
    organizationId: "org",
    applicationUserId: "00000000-0000-0000-0000-000000000001",
    businessUnitId: "unit",
  });
  const output = [];
  assert.equal(
    await runCli(["user", "roles", "--env", "dev", "--caller", "--json"], {
      ...runtime(() => validConfig, output),
      connect: () => client,
    }),
    0,
  );
  assert.match(
    new URL(calls[0]).searchParams.get("$filter"),
    /systemuserid eq 00000000/,
  );
  assert.equal(JSON.parse(output[0]).data.roles.length, 1);
});

test("CLI rejects conflicting output formats before connecting", async () => {
  let reads = 0;
  const code = await runCli(["whoami", "--env", "dev", "--json", "--csv"], {
    ...runtime(() => {
      reads += 1;
      return validConfig;
    }),
  });
  assert.equal(code, 2);
  assert.equal(reads, 0);
});

test("CLI dependency impact returns paths and graph exports stay standalone", async () => {
  const fixture = dependencyFixture();
  const output = [];
  const configured = JSON.stringify({
    configVersion: 1,
    environments: {
      dev: {
        ...JSON.parse(validConfig).environments.dev,
        url: dependencyEnvironment.url,
      },
    },
  });
  const context = {
    ...runtime(() => configured, output),
    connect: () => fixture.client,
  };
  const args = [
    "dependencies",
    "impact",
    "--env",
    "dev",
    "--reference-id",
    referenceId,
    "--depth",
    "6",
  ];
  assert.equal(await runCli([...args, "--json"], context), 0);
  assert.equal(JSON.parse(output[0]).data.analysis.affected.length, 4);
  assert.equal(await runCli([...args, "--html"], context), 0);
  assert.match(output[1], /^<!doctype html>/);
  assert.ok(output[1].includes('id="canvas"'));
  assert.match(output[1], /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!/<script[^>]+src=/.test(output[1]));
  assert.equal(await runCli([...args, "--svg"], context), 0);
  assert.match(output[2], /^<svg [^>]*class="pele pele-flowchart"/);
});

test("CLI partial dependency graphs exit seven and show coverage warnings", async () => {
  const fixture = dependencyFixture({ denied: "RetrieveDependentComponents" });
  const output = [];
  const context = {
    ...runtime(() => validConfig, output),
    connect: () => fixture.client,
  };
  assert.equal(
    await runCli(
      [
        "dependencies",
        "graph",
        "--env",
        "dev",
        "--reference-id",
        referenceId,
        "--mermaid",
      ],
      context,
    ),
    7,
  );
  assert.ok(output[0].includes("closure complete: false"));
});
