import assert from "node:assert/strict";
import test from "node:test";
import {
  createManifest,
  parseModel,
  preservedIdentities,
  verifyTransfer,
} from "@unverse/core";
import { DataverseClient, DataverseError } from "@unverse/dataverse";
import transferData from "../../core/test/fixtures/data.json" with {
  type: "json",
};
import transferModel from "../../core/test/fixtures/schema.json" with {
  type: "json",
};
import { seedSpec } from "../../core/test/fixtures/seed.mjs";
import {
  accessFixture,
  childTeam,
  variableSecret,
} from "../../dataverse/test/fixtures/access.mjs";
import { artifactFixture } from "../../dataverse/test/fixtures/artifacts.mjs";
import { dataFixture } from "../../dataverse/test/fixtures/data.mjs";
import {
  dependencyEnvironment,
  dependencyFixture,
  referenceId,
} from "../../dataverse/test/fixtures/dependencies.mjs";
import {
  appsFirstPage,
  appsLastPage,
  appsPath,
  flowsPage,
  flowsPath,
  platformFixture,
} from "../../dataverse/test/fixtures/platform.mjs";
import { queryFixture } from "../../dataverse/test/fixtures/query.mjs";
import {
  fixture,
  otherRoleId,
  roleId,
} from "../../dataverse/test/fixtures/roles.mjs";
import {
  schemaFixture,
  model as schemaModel,
  solutionComponentFixture,
} from "../../dataverse/test/fixtures/schema.mjs";
import { renderCliReference } from "../dist/help.js";
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

const discoveredConfig = "/work/project/.unverse/config.json";

test("requires an environment before reading configuration", async () => {
  let reads = 0;
  const result = await runCli(
    ["config", "check"],
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
    ["config", "check", "--env", "dev", "--format", "json"],
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
    ["config", "check", "--env", "dev", "--format", "json"],
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
    ["env", "whoami", "--env", "dev", "--format", "json"],
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
    ["env", "whoami", "--env", "dev", "--format", "json"],
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
  assert.equal(JSON.parse(output[0]).command, "env whoami");
  assert.equal(JSON.parse(output[0]).environment.name, "dev");
});

test("doctor reports its limited probe coverage", async () => {
  const output = [];
  const result = await runCli(
    ["env", "doctor", "--env", "dev", "--format", "json"],
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
  assert.equal(document.command, "env doctor");
  assert.equal(document.data.checks.length, 3);
  assert.match(document.coverage.limitations[0], /Only WhoAmI/);
});

test("invalid profiles prevent token acquisition", async () => {
  let calls = 0;
  const result = await runCli(
    ["env", "whoami", "--env", "dev", "--format", "json"],
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
    ["env", "doctor", "--env", "dev", "--format", "json"],
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

test("JSON parse errors remain JSON even when --format json follows the bad flag", async () => {
  const output = [];
  assert.equal(
    await runCli(
      ["env", "whoami", "--bad", "--format", "json"],
      runtime(() => validConfig, output),
    ),
    2,
  );
  assert.equal(JSON.parse(output[0]).status, "error");
});

function runtime(readConfig, output = [], errors = [], secrets = [], whoAmI) {
  return {
    readFile: async () => readConfig(),
    writeFile: async () => {
      throw new Error("unexpected write");
    },
    fileExists: async () => true,
    cwd: "/work/project",
    env: {},
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
    "--format",
    "json",
  ];
  assert.equal(await runCli(["user", "show", ...userArguments], base), 0);
  assert.equal(
    await runCli(
      ["role", "check", ...userArguments, "--role-id", roleId],
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
      "role",
      "check",
      "--env",
      "dev",
      "--email",
      "synthetic@example.invalid",
      "--role-id",
      otherRoleId,
      "--format",
      "json",
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
      "record",
      "query",
      "account",
      "--env",
      "dev",
      "--select",
      "name",
      "--limit",
      "1",
      "--format",
      "json",
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

const mappingDocument = { prefix: "uv", solution: "UnverseFixture" };

test("CLI schema planning reads solution components from the mapping file", async () => {
  const documents = {
    [discoveredConfig]: validConfig,
    "model.json": JSON.stringify(schemaModel),
    "mapping.json": JSON.stringify({
      ...mappingDocument,
      environmentVariables: [
        {
          schemaName: "uv_ApiUrl",
          displayName: "API URL",
          type: "text",
          defaultValue: "https://api.example.test",
        },
      ],
      connectionReferences: [
        {
          displayName: "Office 365-Users",
          connector: "shared_office365users",
        },
      ],
    }),
  };
  const plan = async (flags) => {
    const output = [];
    const code = await runCli(
      ["schema", "plan", "--env", "dev", ...flags, "--format", "json"],
      {
        ...runtime(() => validConfig, output),
        readFile: async (path) =>
          path === discoveredConfig ? validConfig : documents[path],
        connect: () => solutionComponentFixture().client,
      },
    );
    return { code, output };
  };
  const planned = await plan([
    "--mapping-file",
    "mapping.json",
    "--model-file",
    "model.json",
  ]);
  assert.equal(planned.code, 0);
  const kinds = JSON.parse(planned.output[0]).data.operations.map(
    (operation) => operation.kind,
  );
  assert.ok(kinds.includes("create-environment-variable"));
  assert.ok(kinds.includes("create-connection-reference"));
  const removed = await plan([
    "--prefix",
    "uv",
    "--solution",
    "UnverseFixture",
    "--model-file",
    "model.json",
  ]);
  assert.equal(removed.code, 2);
  assert.match(removed.output.join("\n"), /Unknown flag.*--prefix|--prefix/);
});

test("CLI schema planning and confirmed apply share the result contract", async () => {
  const output = [];
  const fixture = schemaFixture();
  let plan;
  const base = {
    ...runtime(() => validConfig, output),
    readFile: async (path) =>
      path === discoveredConfig
        ? validConfig
        : path === "model.json"
          ? JSON.stringify(schemaModel)
          : path === "mapping.json"
            ? JSON.stringify(mappingDocument)
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
        "--mapping-file",
        "mapping.json",
        "--model-file",
        "model.json",
        "--format",
        "json",
      ],
      base,
    ),
    0,
  );
  plan = JSON.parse(output[0]);
  assert.equal(plan.data.provider, "dataverse");
  assert.equal(
    await runCli(
      ["apply", "plan.json", "--env", "dev", "--confirm", "--format", "json"],
      base,
    ),
    0,
  );
  assert.deepEqual(JSON.parse(output[1]).data.operations, []);
});

test("CLI apply without confirmation does not request a token", async () => {
  let calls = 0;
  const result = await runCli(
    ["apply", "plan.json", "--env", "dev", "--format", "json"],
    {
      ...runtime(() => validConfig),
      readFile: async (path) =>
        path === discoveredConfig ? validConfig : "{}",
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

async function planAndApplyData() {
  const fixture = await dataFixture();
  const output = [];
  const documents = {
    [discoveredConfig]: validConfig,
    "seed.json": JSON.stringify(
      seedSpec(fixture.model, fixture.mapping, transferData),
    ),
  };
  const base = {
    ...runtime(() => validConfig, output),
    readFile: async (path) => documents[path],
    connect: () => fixture.client,
  };
  assert.equal(
    await runCli(
      [
        "seed",
        "plan",
        "--env",
        "dev",
        "--seed-file",
        "seed.json",
        "--format",
        "json",
      ],
      base,
    ),
    0,
  );
  documents["plan.json"] = output[0];
  const code = await runCli(
    ["apply", "plan.json", "--env", "dev", "--confirm", "--format", "json"],
    base,
  );
  return { code, fixture, output, base };
}

test("apply dispatches schema and data plans by kind", async () => {
  const schema = schemaFixture();
  const output = [];
  const documents = {
    [discoveredConfig]: validConfig,
    "model.json": JSON.stringify(schemaModel),
    "mapping.json": JSON.stringify(mappingDocument),
  };
  const base = {
    ...runtime(() => validConfig, output),
    readFile: async (path) => documents[path],
    connect: () => schema.client,
  };
  await runCli(
    [
      "schema",
      "plan",
      "--env",
      "dev",
      "--mapping-file",
      "mapping.json",
      "--model-file",
      "model.json",
      "--format",
      "json",
    ],
    base,
  );
  const planned = JSON.parse(output[0]).data;
  assert.equal(planned.kind, "schema");
  assert.equal(planned.effect, "write");
  documents["plan.json"] = JSON.stringify(planned);
  const writesBefore = schema.writes.length;
  assert.equal(
    await runCli(
      ["apply", "plan.json", "--env", "dev", "--confirm", "--format", "json"],
      base,
    ),
    0,
  );
  assert.ok(schema.writes.length > writesBefore);

  const data = await planAndApplyData();
  assert.equal(data.code, 0);
  assert.equal(JSON.parse(data.output[0]).data.kind, "data");
  assert.equal(JSON.parse(data.output[0]).data.effect, "write");
  assert.equal(JSON.parse(data.output[1]).data.verified, true);
  assert.equal(data.fixture.batches.length, 1);
});

test("apply refuses a destructive plan without --destructive before any request", async () => {
  let connections = 0;
  let requests = 0;
  const plan = JSON.stringify({ kind: "schema", effect: "destructive" });
  const base = {
    ...runtime(() => validConfig),
    readFile: async (path) => (path === discoveredConfig ? validConfig : plan),
    connect: () => {
      connections += 1;
      return {
        whoAmI: async () => {
          requests += 1;
          throw new DataverseError("service", "stop");
        },
      };
    },
  };
  const arguments_ = ["apply", "plan.json", "--env", "dev", "--confirm"];
  assert.equal(await runCli(arguments_, base), 2);
  assert.equal(connections, 0);
  assert.equal(requests, 0);
  await runCli([...arguments_, "--destructive"], base);
  assert.equal(requests, 1);
});

test("verify reports an unsatisfied plan with exit 1 and a satisfied one with exit 0 without writing", async () => {
  const schema = schemaFixture();
  const output = [];
  const documents = {
    [discoveredConfig]: validConfig,
    "model.json": JSON.stringify(schemaModel),
    "mapping.json": JSON.stringify(mappingDocument),
  };
  const base = {
    ...runtime(() => validConfig, output),
    readFile: async (path) => documents[path],
    connect: () => schema.client,
  };
  await runCli(
    [
      "schema",
      "plan",
      "--env",
      "dev",
      "--mapping-file",
      "mapping.json",
      "--model-file",
      "model.json",
      "--format",
      "json",
    ],
    base,
  );
  documents["plan.json"] = output[0];
  const verify = ["verify", "plan.json", "--env", "dev", "--format", "json"];
  assert.equal(await runCli(verify, base), 1);
  assert.equal(JSON.parse(output[1]).data.satisfied, false);
  assert.ok(JSON.parse(output[1]).data.operations.length > 0);
  assert.equal(schema.writes.length, 0);
  assert.equal(
    await runCli(
      ["apply", "plan.json", "--env", "dev", "--confirm", "--format", "json"],
      base,
    ),
    0,
  );
  const writes = schema.writes.length;
  assert.equal(await runCli(verify, base), 0);
  assert.equal(JSON.parse(output[3]).data.satisfied, true);
  assert.equal(schema.writes.length, writes);

  const data = await planAndApplyData();
  const batches = data.fixture.batches.length;
  assert.equal(await runCli(verify, data.base), 0);
  assert.equal(JSON.parse(data.output[2]).data.kind, "data");
  assert.equal(JSON.parse(data.output[2]).data.satisfied, true);
  assert.equal(data.fixture.batches.length, batches);
});

test("the per-kind apply commands are unknown", async () => {
  for (const group of ["schema", "seed", "transfer"])
    await rejected(
      [group, "apply", "--env", "dev", "--plan-file", "p.json", "--confirm"],
      new RegExp(`Unknown command ${group} apply\\.`),
    );
});

test("CLI transfer import requires confirmation before connecting", async () => {
  let connections = 0;
  const result = await runCli(
    [
      "pg",
      "import",
      "--env",
      "dev",
      "--manifest-file",
      "manifest.json",
      "--format",
      "json",
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
      "pg",
      "verify",
      "--env",
      "dev",
      "--manifest-file",
      "manifest.json",
      "--format",
      "json",
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
    await runCli(
      ["user", "show", "--env", "dev", "--caller", "--format", "json"],
      {
        ...runtime(() => validConfig, output),
        connect: () => client,
      },
    ),
    0,
  );
  assert.match(
    new URL(calls[0]).searchParams.get("$filter"),
    /systemuserid eq 00000000/,
  );
  assert.equal(JSON.parse(output[0]).data.roles.length, 1);
});

test("CLI rejects a format the command does not offer before connecting", async () => {
  let reads = 0;
  const code = await runCli(
    ["env", "whoami", "--env", "dev", "--format", "html"],
    {
      ...runtime(() => {
        reads += 1;
        return validConfig;
      }),
    },
  );
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
    "deps",
    "impact",
    "--env",
    "dev",
    "--reference-id",
    referenceId,
    "--depth",
    "6",
  ];
  assert.equal(await runCli([...args, "--format", "json"], context), 0);
  assert.equal(JSON.parse(output[0]).data.analysis.affected.length, 4);
  assert.equal(await runCli([...args, "--format=html"], context), 0);
  assert.match(output[1], /^<!doctype html>/);
  assert.ok(output[1].includes('id="canvas"'));
  assert.match(output[1], /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!/<script[^>]+src=/.test(output[1]));
  assert.equal(await runCli([...args, "--format", "svg"], context), 0);
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
        "deps",
        "graph",
        "--env",
        "dev",
        "--reference-id",
        referenceId,
        "--format",
        "mermaid",
      ],
      context,
    ),
    7,
  );
  assert.ok(output[0].includes("closure complete: false"));
});

const pinnedOrganization = "11111111-2222-3333-4444-555555555555";
const otherOrganization = "99999999-2222-3333-4444-555555555555";

function pinnedConfig(devPin, testPin) {
  const profile = (host, pin) => ({
    url: `https://${host}.crm.dynamics.com`,
    tenantIdEnv: "UNVERSE_TENANT_ID",
    clientIdEnv: "UNVERSE_CLIENT_ID",
    clientSecretEnv: "UNVERSE_CLIENT_SECRET",
    ...(pin === undefined ? {} : { expectedOrganizationId: pin }),
  });
  return JSON.stringify({
    configVersion: 1,
    environments: {
      dev: profile("dev", devPin),
      test: profile("test", testPin),
    },
  });
}

function pinnedRuntime(config, organizations, requests, output = []) {
  return {
    ...runtime(() => config, output),
    connect: (profile, name) =>
      new DataverseClient(
        profile.url,
        { getToken: async () => "token" },
        {
          get: async (url) => {
            const { host, pathname } = new URL(url);
            requests.push(`${host}${pathname.replace("/api/data/v9.2", "")}`);
            return {
              status: 200,
              headers: {},
              body: JSON.stringify(
                pathname.endsWith("/WhoAmI")
                  ? {
                      OrganizationId: organizations[name],
                      UserId: "app",
                      BusinessUnitId: "unit",
                    }
                  : { value: [] },
              ),
            };
          },
        },
        { wait: async () => {}, now: () => 0 },
        5000,
        profile.expectedOrganizationId === undefined
          ? undefined
          : { profile: name, organizationId: profile.expectedOrganizationId },
      ),
  };
}

test("config check rejects a malformed expected organization without contacting Dataverse", async () => {
  const requests = [];
  const output = [];
  const result = await runCli(
    ["config", "check", "--env", "dev", "--format", "json"],
    pinnedRuntime(pinnedConfig("not-a-guid"), {}, requests, output),
  );
  assert.equal(result, 2);
  assert.deepEqual(requests, []);
  assert.match(JSON.parse(output[0]).error.message, /expectedOrganizationId/);
});

test("env whoami and env doctor report a matching expected organization as evidence", async () => {
  for (const command of ["whoami", "doctor"]) {
    const requests = [];
    const output = [];
    const result = await runCli(
      ["env", command, "--env", "dev", "--format", "json"],
      pinnedRuntime(
        pinnedConfig(pinnedOrganization),
        { dev: pinnedOrganization },
        requests,
        output,
      ),
    );
    assert.equal(result, 0);
    assert.deepEqual(requests, ["dev.crm.dynamics.com/WhoAmI"]);
    assert.ok(
      JSON.parse(output[0]).evidence.some((line) =>
        line.includes(`matches expectedOrganizationId ${pinnedOrganization}`),
      ),
    );
  }
});

test("a profile without an expected organization adds no match evidence", async () => {
  const output = [];
  await runCli(
    ["env", "whoami", "--env", "dev", "--format", "json"],
    pinnedRuntime(pinnedConfig(), { dev: otherOrganization }, [], output),
  );
  assert.deepEqual(JSON.parse(output[0]).evidence.slice(2), [
    "Dataverse WhoAmI completed.",
  ]);
});

test("an organization mismatch exits two after WhoAmI and before any other request", async () => {
  const requests = [];
  const output = [];
  const result = await runCli(
    ["table", "list", "--env", "dev", "--format", "json"],
    pinnedRuntime(
      pinnedConfig(pinnedOrganization),
      { dev: otherOrganization },
      requests,
      output,
    ),
  );
  assert.equal(result, 2);
  assert.deepEqual(requests, ["dev.crm.dynamics.com/WhoAmI"]);
  const { error } = JSON.parse(output[0]);
  assert.equal(error.code, "invalid-input");
  assert.ok(error.message.includes('"dev"'));
  assert.ok(error.message.includes(pinnedOrganization));
  assert.ok(error.message.includes(otherOrganization));
});

test("doctor reports an organization mismatch as a failed WhoAmI after a token", async () => {
  const output = [];
  const result = await runCli(
    ["env", "doctor", "--env", "dev", "--format", "json"],
    pinnedRuntime(
      pinnedConfig(pinnedOrganization),
      { dev: otherOrganization },
      [],
      output,
    ),
  );
  assert.equal(result, 2);
  assert.deepEqual(
    JSON.parse(output[0]).data.checks.map((check) => [
      check.name,
      check.status,
    ]),
    [
      ["configuration", "ok"],
      ["token", "ok"],
      ["WhoAmI", "error"],
    ],
  );
});

test("environment compare checks the source and the target profile", async () => {
  const compare = [
    "env",
    "compare",
    "--env",
    "dev",
    "--target-env",
    "test",
    "--format",
    "json",
  ];
  const sourceRequests = [];
  assert.equal(
    await runCli(
      compare,
      pinnedRuntime(
        pinnedConfig(pinnedOrganization, pinnedOrganization),
        { dev: otherOrganization, test: pinnedOrganization },
        sourceRequests,
      ),
    ),
    2,
  );
  assert.deepEqual(sourceRequests, ["dev.crm.dynamics.com/WhoAmI"]);
  const targetRequests = [];
  assert.equal(
    await runCli(
      compare,
      pinnedRuntime(
        pinnedConfig(pinnedOrganization, pinnedOrganization),
        { dev: pinnedOrganization, test: otherOrganization },
        targetRequests,
      ),
    ),
    2,
  );
  assert.deepEqual(targetRequests, [
    "dev.crm.dynamics.com/WhoAmI",
    "test.crm.dynamics.com/WhoAmI",
  ]);
});

const twoEnvironments = JSON.stringify({
  configVersion: 1,
  environments: {
    dev: {
      url: "https://dev.crm.dynamics.com/",
      tenantIdEnv: "SECRET_TENANT_NAME",
      clientIdEnv: "SECRET_CLIENT_NAME",
      clientSecretEnv: "SECRET_VALUE_NAME",
    },
    prod: {
      url: "https://prod.crm.dynamics.com",
      tenantIdEnv: "SECRET_TENANT_NAME",
      clientIdEnv: "SECRET_CLIENT_NAME",
      clientSecretEnv: "SECRET_VALUE_NAME",
    },
  },
});

async function rejected(args, pattern) {
  const output = [];
  const errors = [];
  let connections = 0;
  const code = await runCli(args, {
    ...runtime(() => validConfig, output, errors),
    connect: () => {
      connections += 1;
    },
  });
  assert.equal(code, 2, args.join(" "));
  assert.equal(connections, 0);
  assert.deepEqual(output, []);
  assert.match(errors.join(""), pattern);
}

async function queried(args) {
  const output = [];
  const code = await runCli(args, {
    ...runtime(() => validConfig, output),
    connect: () => queryFixture().client,
  });
  return { code, output };
}

test("flag values bind with an equals sign or as the next token", async () => {
  const { code, output } = await queried([
    "record",
    "query",
    "account",
    "--env=dev",
    "--select=name",
    "--limit=1",
    "--format=json",
  ]);
  assert.equal(code, 7);
  assert.equal(JSON.parse(output[0]).data.rows.length, 1);
});

test("an empty attached value is bound and then validated", async () => {
  await rejected(
    ["env", "whoami", "--env", "dev", "--format="],
    /--format must be one of/,
  );
});

test("a double dash ends flag parsing", async () => {
  const { code, output } = await queried([
    "record",
    "query",
    "--env",
    "dev",
    "--select",
    "name",
    "--format",
    "json",
    "--",
    "account",
  ]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(output[0]).status, "ok");
  await rejected(
    ["record", "query", "--env", "dev", "--", "account", "--select", "name"],
    /Unexpected argument --select\./,
  );
});

test("help flags print help without reading configuration", async () => {
  for (const flag of ["-h", "--help"]) {
    const output = [];
    const errors = [];
    let reads = 0;
    const code = await runCli(["role", "check", flag], {
      ...runtime(
        () => {
          reads += 1;
          return validConfig;
        },
        output,
        errors,
      ),
    });
    assert.equal(code, 0);
    assert.equal(reads, 0);
    assert.deepEqual(errors, []);
    assert.match(output[0], /^unverse role check /);
    assert.match(output[0], /Select exactly one of --role-id or --role\./);
  }
});

test("a bare group prints group help to stderr and exits two", async () => {
  const output = [];
  const errors = [];
  assert.equal(
    await runCli(
      ["table"],
      runtime(() => validConfig, output, errors),
    ),
    2,
  );
  assert.deepEqual(output, []);
  assert.match(errors[0], /^unverse table — /);
  assert.match(errors[0], /unverse table list {2}read /);
  const requested = [];
  assert.equal(
    await runCli(
      ["table", "--help"],
      runtime(() => validConfig, requested),
    ),
    0,
  );
  assert.equal(requested[0], errors[0]);
});

test("an exactly-one-of group rejects none and several of its flags", async () => {
  const selector =
    /Select exactly one of --user-id, --email, --domain, --name, or --caller\./;
  await rejected(["user", "show", "--env", "dev"], selector);
  await rejected(
    [
      "user",
      "show",
      "--env",
      "dev",
      "--email",
      "a@example.invalid",
      "--caller",
    ],
    selector,
  );
  await rejected(
    ["role", "check", "--env", "dev", "--caller"],
    /Select exactly one of --role-id or --role\./,
  );
  await rejected(
    [
      "role",
      "check",
      "--env",
      "dev",
      "--caller",
      "--role-id",
      roleId,
      "--role",
      "x",
    ],
    /Select exactly one of --role-id or --role\./,
  );
});

test("format values are limited to those the command offers", async () => {
  await rejected(
    ["env", "whoami", "--env", "dev", "--format", "html"],
    /--format must be one of human, json, csv\./,
  );
  await rejected(
    [
      "deps",
      "graph",
      "--env",
      "dev",
      "--reference-id",
      referenceId,
      "--format",
      "xml",
    ],
    /--format must be one of human, json, csv, html, mermaid, svg\./,
  );
  await rejected(
    ["app", "list", "--env", "dev", "--kind", "other"],
    /--kind must be one of all, canvas, model-driven\./,
  );
});

test("flags are exact, known, valid for the command, and given once", async () => {
  await rejected(
    ["env", "whoami", "--env", "dev", "--bad"],
    /Unknown flag --bad\./,
  );
  await rejected(["env", "whoami", "--env", "dev", "-x"], /Unknown flag -x\./);
  await rejected(["env", "whoami", "--en", "dev"], /Unknown flag --en\./);
  await rejected(
    ["env", "whoami", "--env", "dev", "--search", "a"],
    /Flag --search is not valid for env whoami\./,
  );
  await rejected(
    ["env", "whoami", "--env", "dev", "--env", "prod"],
    /Duplicate flag --env\./,
  );
  await rejected(["env", "whoami", "--env"], /--env requires a value\./);
  await rejected(
    ["env", "whoami", "--env", "--format"],
    /--env requires a value\./,
  );
  await rejected(
    ["apply", "p.json", "--env", "dev", "--confirm=yes"],
    /--confirm does not take a value\./,
  );
  await rejected(["env", "whoami"], /An environment is required/);
  await rejected(
    ["apply", "p.json", "--env", "dev"],
    /--confirm is required\./,
  );
  await rejected(
    ["verify", "p.json", "--env", "dev", "--confirm"],
    /Flag --confirm is not valid for verify\./,
  );
});

test("commands are exact and positionals are counted", async () => {
  await rejected(
    ["tables", "list", "--env", "dev"],
    /Unknown command tables\./,
  );
  await rejected(
    ["table", "lst", "--env", "dev"],
    /Unknown command table lst\./,
  );
  await rejected(
    ["--env", "dev", "table", "list"],
    /Expected a command before --env\./,
  );
  await rejected(
    ["record", "query", "--env", "dev", "--select", "name"],
    /<table> is required\./,
  );
  await rejected(
    [
      "record",
      "query",
      "account",
      "contact",
      "--env",
      "dev",
      "--select",
      "name",
    ],
    /Unexpected argument contact\./,
  );
  await rejected(
    ["table", "list", "extra", "--env", "dev"],
    /Unexpected argument extra\./,
  );
});

test("env list shows names and URLs offline without secrets", async () => {
  const output = [];
  let connections = 0;
  const code = await runCli(["env", "list", "--format", "json"], {
    ...runtime(() => twoEnvironments, output),
    connect: () => {
      connections += 1;
    },
  });
  assert.equal(code, 0);
  assert.equal(connections, 0);
  const document = JSON.parse(output[0]);
  assert.equal(document.command, "env list");
  assert.deepEqual(document.data.environments, [
    { name: "dev", url: "https://dev.crm.dynamics.com" },
    { name: "prod", url: "https://prod.crm.dynamics.com" },
  ]);
  assert.doesNotMatch(output[0], /SECRET/);
});

test("every command declares its effect in help, the reference, and the spec", async () => {
  const output = [];
  assert.equal(
    await runCli(
      ["spec", "--format", "json"],
      runtime(() => validConfig, output),
    ),
    0,
  );
  const document = JSON.parse(output[0]);
  const effects = Object.fromEntries(
    document.commands.map((command) => [command.path, command.effect]),
  );
  assert.equal(effects.apply, "write");
  assert.equal(effects.verify, "read");
  assert.equal(effects["pg import"], "write");
  assert.equal(effects["table list"], "read");
  assert.equal(effects.spec, "read");
  const help = [];
  await runCli(
    ["--help"],
    runtime(() => validConfig, help),
  );
  const reference = renderCliReference();
  for (const command of document.commands) {
    assert.ok(["read", "write", "destructive"].includes(command.effect));
    assert.match(
      help[0],
      new RegExp(`^ {2}${command.path} +${command.effect} `, "m"),
    );
    assert.ok(
      reference.includes(
        `## ${command.path}\n\n${command.summary}\n\n- Effect: \`${command.effect}\``,
      ),
      command.path,
    );
    const names = command.flags.map((flag) => flag.name);
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.includes("--confirm"), command.effect !== "read");
    for (const group of command.groups)
      for (const name of group.flags) assert.ok(names.includes(name));
  }
});

test("artifact types lists the catalog offline without reading configuration", async () => {
  const output = [];
  let reads = 0;
  const result = await runCli(
    ["artifact", "types", "--format", "json"],
    runtime(() => {
      reads += 1;
      return validConfig;
    }, output),
  );
  assert.equal(result, 0);
  assert.equal(reads, 0);
  const types = JSON.parse(output[0]).data.types;
  assert.ok(types.some((entry) => entry.type === "canvas-app"));
  assert.ok(types.every((entry) => entry.platformName && entry.fields));
});

test("artifact list returns normalized items for a catalog type", async () => {
  const output = [];
  const result = await runCli(
    ["artifact", "list", "canvas-app", "--env", "dev", "--format", "json"],
    {
      ...runtime(() => validConfig, output),
      connect: () => artifactFixture().client,
    },
  );
  assert.equal(result, 0);
  const document = JSON.parse(output[0]);
  assert.equal(document.coverage.complete, true);
  assert.deepEqual(document.data.items.map((row) => row.kind).sort(), [
    "classic",
    "code-app",
    "unknown",
  ]);
});

test("an artifact type outside the catalog exits two before connecting", async () => {
  const errors = [];
  let connections = 0;
  const result = await runCli(
    ["artifact", "list", "nonsense", "--env", "dev"],
    {
      ...runtime(() => validConfig, [], errors),
      connect: () => {
        connections += 1;
        return artifactFixture().client;
      },
    },
  );
  assert.equal(result, 2);
  assert.equal(connections, 0);
  assert.match(
    errors[0],
    /Unknown type nonsense; choose one of table, canvas-app/,
  );
});

test("a capped artifact list is inconclusive and exits seven", async () => {
  const output = [];
  const result = await runCli(
    [
      "artifact",
      "list",
      "canvas-app",
      "--env",
      "dev",
      "--limit",
      "1",
      "--format",
      "json",
    ],
    {
      ...runtime(() => validConfig, output),
      connect: () => artifactFixture().client,
    },
  );
  assert.equal(result, 7);
  const document = JSON.parse(output[0]);
  assert.equal(document.status, "inconclusive");
  assert.equal(document.coverage.complete, false);
  assert.equal(document.data.items.length, 1);
});

const platformId = "11111111-2222-3333-4444-555555555555";
const platformConfig = (extra = {}) =>
  JSON.stringify({
    configVersion: 1,
    environments: {
      dev: { ...JSON.parse(validConfig).environments.dev, ...extra },
    },
  });

async function platformList(argv, config, connectPlatform) {
  const output = [];
  const errors = [];
  let platformConnections = 0;
  const code = await runCli(argv, {
    ...runtime(() => config, output, errors),
    connect: () => {
      throw new Error("Dataverse must not be contacted.");
    },
    connectPlatform: (profile, id) => {
      platformConnections += 1;
      assert.equal(id, platformId);
      return connectPlatform(profile, id);
    },
  });
  return {
    code,
    output,
    errors,
    platformConnections: () => platformConnections,
  };
}

test("platform source lists apps and flows with a source field and no invented fields", async () => {
  const platform = platformFixture({
    routes: {
      [appsPath]: [appsFirstPage, appsLastPage],
      [flowsPath]: [flowsPage],
    },
  });
  const config = platformConfig({ platformEnvironmentId: platformId });
  const apps = await platformList(
    ["app", "list", "--env", "dev", "--source", "platform", "--format", "json"],
    config,
    () => platform.client,
  );
  assert.equal(apps.code, 0);
  const appDocument = JSON.parse(apps.output[0]);
  assert.deepEqual(
    appDocument.data.apps.map((row) => row.source),
    ["platform", "platform"],
  );
  assert.ok(!("kind" in appDocument.data.apps[0]));
  assert.ok(!("state" in appDocument.data.apps[0]));
  assert.match(appDocument.coverage.limitations.join(" "), /RBAC role/);
  const flows = await platformList(
    [
      "flow",
      "list",
      "--env",
      "dev",
      "--source",
      "platform",
      "--format",
      "json",
    ],
    config,
    () => platform.client,
  );
  assert.equal(flows.code, 0);
  assert.equal(JSON.parse(flows.output[0]).data.flows.length, 2);
});

test("platform source without platformEnvironmentId exits two before any connection", async () => {
  const result = await platformList(
    [
      "flow",
      "list",
      "--env",
      "dev",
      "--source",
      "platform",
      "--format",
      "json",
    ],
    platformConfig(),
    () => assert.fail("must not connect"),
  );
  assert.equal(result.code, 2);
  assert.equal(result.platformConnections(), 0);
  assert.match(
    JSON.parse(result.output[0]).error.message,
    /platformEnvironmentId/,
  );
});

test("platform permission failures exit four instead of listing nothing", async () => {
  const platform = platformFixture({
    routes: {},
    status: { [flowsPath]: 403 },
  });
  const result = await platformList(
    [
      "flow",
      "list",
      "--env",
      "dev",
      "--source",
      "platform",
      "--format",
      "json",
    ],
    platformConfig({ platformEnvironmentId: platformId }),
    () => platform.client,
  );
  assert.equal(result.code, 4);
  assert.equal(JSON.parse(result.output[0]).status, "error");
});

test("the Dataverse source is the default and adds no source field", async () => {
  for (const extra of [[], ["--source", "dataverse"]]) {
    const output = [];
    const code = await runCli(
      ["flow", "list", "--env", "dev", "--format", "json", ...extra],
      {
        ...runtime(() => platformConfig(), output),
        connect: () => ({
          whoAmI: async () => ({
            organizationId: "org",
            applicationUserId: "app",
            businessUnitId: "bu",
          }),
          collect: async () => ({
            rows: [
              {
                workflowid: "00000000-0000-0000-0000-000000000006",
                name: "Example Flow",
                uniquename: null,
                statecode: 1,
              },
            ],
            complete: true,
          }),
        }),
      },
    );
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(output[0]).data.flows, [
      {
        id: "00000000-0000-0000-0000-000000000006",
        name: "Example Flow",
        uniqueName: null,
        kind: "cloud-flow",
        state: 1,
      },
    ]);
  }
});

test("access plan, apply and verify assign roles through one reviewed plan", async () => {
  const fixture = accessFixture();
  const output = [];
  const documents = {
    [discoveredConfig]: validConfig,
    "access.json": JSON.stringify({
      accessVersion: 1,
      teams: [{ team: { id: childTeam }, roles: ["sr-Example-Users"] }],
    }),
    "secret.json": JSON.stringify({
      accessVersion: 1,
      teams: [{ team: { environmentVariable: variableSecret }, roles: ["x"] }],
    }),
  };
  const base = {
    ...runtime(() => validConfig, output),
    readFile: async (path) => documents[path],
    connect: () => fixture.client,
  };
  const common = ["--env", "dev", "--format", "json"];
  assert.equal(
    await runCli(
      ["access", "plan", ...common, "--access-file", "access.json"],
      base,
    ),
    0,
  );
  const reviewed = JSON.parse(output[0]).data;
  assert.equal(reviewed.kind, "access");
  documents["plan.json"] = output[0];
  assert.equal(await runCli(["verify", "plan.json", ...common], base), 1);
  assert.equal(
    await runCli(["apply", "plan.json", "--confirm", ...common], base),
    0,
  );
  assert.equal(fixture.writes.length, 1);
  assert.equal(await runCli(["verify", "plan.json", ...common], base), 0);
  assert.equal(
    await runCli(
      ["access", "plan", ...common, "--access-file", "secret.json"],
      base,
    ),
    2,
  );
});
