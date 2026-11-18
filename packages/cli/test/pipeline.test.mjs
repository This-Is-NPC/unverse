import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  createManifest,
  fingerprint,
  seedDesired,
  transferDesired,
} from "@unverse/core";
import { DataverseError, planDesired } from "@unverse/dataverse";
import transferData from "../../core/test/fixtures/data.json" with {
  type: "json",
};
import { seedSpec } from "../../core/test/fixtures/seed.mjs";
import { dataFixture } from "../../dataverse/test/fixtures/data.mjs";
import { runCli } from "../dist/run.js";

const profile = (host) => ({
  url: `https://${host}.crm.dynamics.com`,
  tenantIdEnv: "UNVERSE_TENANT_ID",
  clientIdEnv: "UNVERSE_CLIENT_ID",
  clientSecretEnv: "UNVERSE_CLIENT_SECRET",
});
const config = JSON.stringify({
  configVersion: 1,
  environments: { dev: profile("dev"), src: profile("src") },
});

async function inProject(files, body) {
  const root = mkdtempSync(join(tmpdir(), "unverse-pipeline-"));
  try {
    for (const [path, content] of Object.entries({
      ".unverse/config.json": config,
      ...files,
    })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    mkdirSync(join(root, "deep", "er"), { recursive: true });
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function run(args, cwd, connect, secrets = []) {
  const output = [];
  const errors = [];
  const code = await runCli(args, {
    readFile: (path) => readFile(path, "utf8"),
    writeFile: async () => {
      throw new Error("unexpected write");
    },
    fileExists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    listDirectory: (path) => readdir(path),
    loadModule: (path) => import(pathToFileURL(path).href),
    cwd,
    env: {},
    now: () => "2026-10-16T00:00:00.000Z",
    writeOut: (line) => output.push(line),
    writeError: (line) => errors.push(line),
    secrets,
    connect,
  });
  return { code, output, errors };
}

function moduleText(fixture, { params = "[]", body = "" } = {}) {
  const data = structuredClone(transferData);
  return `export default {
  description: "Synthetic pipeline.",
  params: ${params},
  run: async (ctx) => {
    ${body}
    const parent = await ctx.seedId("ns", "parent", "p");
    const child = await ctx.seedId("ns", "child", "c");
    const data = ${JSON.stringify(data)};
    data.parent[0].id = parent;
    data.child[0].id = child;
    data.child[0].parentid = parent;
    return { model: ${JSON.stringify(fixture.model)}, mapping: ${JSON.stringify(fixture.mapping)}, data };
  },
};
`;
}

const labelParam = `[{ name: "--label", value: "text", summary: "A label.", required: true, choices: ["a", "b"] }]`;

test("pipeline discovery finds ts and mjs files from a nested project directory", async () => {
  const fixture = await dataFixture();
  await inProject(
    {
      ".unverse/pipelines/alpha.mjs": moduleText(fixture),
      ".unverse/pipelines/beta.ts": moduleText(fixture).replace(
        "async (ctx)",
        "async (ctx: unknown)",
      ),
      ".unverse/pipelines/notes.md": "ignored",
    },
    async (root) => {
      const { code, output } = await run(
        ["pipeline", "list", "--format", "json"],
        join(root, "deep", "er"),
      );
      assert.equal(code, 0);
      const { pipelines } = JSON.parse(output[0]).data;
      assert.deepEqual(
        pipelines.map(({ name, origin }) => [name, origin]),
        [
          ["seed", "built-in"],
          ["transfer", "built-in"],
          ["alpha", "project"],
          ["beta", "project"],
        ],
      );
      assert.equal(pipelines[2].description, "Synthetic pipeline.");
    },
  );
});

test("a project pipeline cannot shadow a built-in", async () => {
  const fixture = await dataFixture();
  await inProject(
    { ".unverse/pipelines/seed.mjs": moduleText(fixture) },
    async (root) => {
      const { code, errors } = await run(["pipeline", "list"], root);
      assert.equal(code, 2);
      assert.match(errors.join(""), /shadow the built-in pipeline seed/);
    },
  );
});

test("pipeline names are unique and well formed", async () => {
  const fixture = await dataFixture();
  const text = moduleText(fixture);
  await inProject(
    { ".unverse/pipelines/same.mjs": text, ".unverse/pipelines/same.ts": text },
    async (root) => {
      const { code, errors } = await run(["pipeline", "list"], root);
      assert.equal(code, 2);
      assert.match(errors.join(""), /both \.ts and \.mjs/);
    },
  );
  await inProject({ ".unverse/pipelines/Bad_Name.mjs": text }, async (root) => {
    const { code, errors } = await run(["pipeline", "list"], root);
    assert.equal(code, 2);
    assert.match(errors.join(""), /invalid pipeline name/);
  });
  await inProject(
    { ".unverse/pipelines/broken.mjs": "export default { run() {} };" },
    async (root) => {
      const { code, errors } = await run(["pipeline", "show", "broken"], root);
      assert.equal(code, 2);
      assert.match(errors.join(""), /description must be a non-empty string/);
    },
  );
});

test("pipeline show prints the description and the declared flags", async () => {
  const fixture = await dataFixture();
  await inProject(
    {
      ".unverse/pipelines/alpha.mjs": moduleText(fixture, {
        params: labelParam,
      }),
    },
    async (root) => {
      const { code, output } = await run(
        ["pipeline", "show", "alpha", "--format", "json"],
        root,
      );
      assert.equal(code, 0);
      const { data } = JSON.parse(output[0]);
      assert.equal(data.description, "Synthetic pipeline.");
      assert.equal(data.params[0].name, "--label");
      assert.equal(data.usage, "unverse pipeline plan alpha -- --label <a|b>");
    },
  );
});

test("pipeline flags after the separator are parsed against the pipeline's own spec", async () => {
  const fixture = await dataFixture();
  await inProject(
    {
      ".unverse/pipelines/alpha.mjs": moduleText(fixture, {
        params: labelParam,
      }),
    },
    async (root) => {
      let connections = 0;
      const connect = () => {
        connections += 1;
        return fixture.client;
      };
      const plan = (...rest) => [
        "pipeline",
        "plan",
        "alpha",
        "--env",
        "dev",
        "--format",
        "json",
        ...rest,
      ];
      for (const [rest, pattern] of [
        [["--"], /--label is required/],
        [["--", "--label", "c"], /--label must be one of a, b/],
        [["--", "--label", "a", "--other", "x"], /Unknown flag --other/],
        [["--", "--label", "a", "--label", "b"], /Duplicate flag --label/],
        [["--", "--label", "a", "stray"], /Unexpected argument stray/],
        [["--", "--env", "dev", "--label", "a"], /--env is not valid/],
      ]) {
        const result = await run(plan(...rest), root, connect);
        assert.equal(result.code, 2, rest.join(" "));
        assert.match(result.errors.join("") + result.output.join(""), pattern);
      }
      assert.equal(connections, 0);
      const help = await run(plan("--", "--help"), root, connect);
      assert.equal(help.code, 0);
      assert.match(help.output.join(""), /--label <a\|b>/);
      assert.equal(connections, 0);
      const ok = await run(plan("--", "--label=a"), root, connect);
      assert.equal(ok.code, 0, ok.errors.join(""));
    },
  );
});

test("a pipeline plan applies with the existing apply command", async () => {
  const fixture = await dataFixture();
  await inProject(
    {
      ".unverse/pipelines/alpha.mjs": moduleText(fixture),
      ".unverse/pipelines/beta.ts": moduleText(fixture).replace(
        "async (ctx)",
        "async (ctx: unknown)",
      ),
    },
    async (root) => {
      const connect = () => fixture.client;
      const planned = await run(
        ["pipeline", "plan", "beta", "--env", "dev", "--format", "json"],
        root,
        connect,
      );
      assert.equal(planned.code, 0, planned.errors.join(""));
      const document = JSON.parse(planned.output[0]);
      assert.equal(document.data.kind, "data");
      assert.equal(document.data.purpose, "seed");
      assert.equal(document.data.effect, "write");
      assert.equal(document.data.create.length, 2);
      assert.equal(fixture.batches.length, 0);
      const path = join(root, "plan.json");
      writeFileSync(path, planned.output[0]);
      const applied = await run(
        ["apply", path, "--env", "dev", "--confirm", "--format", "json"],
        root,
        connect,
      );
      assert.equal(applied.code, 0, applied.errors.join(""));
      assert.equal(JSON.parse(applied.output[0]).data.verified, true);
      assert.equal(fixture.batches.length, 1);
    },
  );
});

test("a path argument runs that file directly", async () => {
  const fixture = await dataFixture();
  await inProject(
    { "elsewhere/one-off.mjs": moduleText(fixture) },
    async (root) => {
      const result = await run(
        [
          "pipeline",
          "plan",
          "../../elsewhere/one-off.mjs",
          "--env",
          "dev",
          "--format",
          "json",
        ],
        join(root, "deep", "er"),
        () => fixture.client,
      );
      assert.equal(result.code, 0, result.errors.join(""));
      assert.equal(JSON.parse(result.output[0]).data.create.length, 2);
    },
  );
});

test("an unknown pipeline name exits two", async () => {
  await inProject({}, async (root) => {
    const result = await run(["pipeline", "show", "nothing"], root);
    assert.equal(result.code, 2);
    assert.match(result.errors.join(""), /Unknown pipeline nothing/);
  });
});

test("the context hands a pipeline no way to write", async () => {
  const fixture = await dataFixture();
  await inProject(
    {
      ".unverse/pipelines/alpha.mjs": moduleText(fixture, {
        body: "globalThis.handedContext = ctx;",
      }),
    },
    async (root) => {
      const result = await run(
        ["pipeline", "plan", "alpha", "--env", "dev"],
        root,
        () => fixture.client,
      );
      assert.equal(result.code, 0, result.errors.join(""));
      const context = globalThis.handedContext;
      delete globalThis.handedContext;
      assert.deepEqual(Object.getOwnPropertyNames(context).sort(), [
        "params",
        "read",
        "readJson",
        "seedId",
        "target",
      ]);
      assert.deepEqual(Object.getOwnPropertySymbols(context), []);
      assert.equal(Object.getPrototypeOf(context), Object.prototype);
      assert.ok(Object.isFrozen(context));
      assert.equal(context.target, "dev");
      for (const value of Object.values(context))
        assert.notEqual(value?.constructor?.name, "DataverseClient");
    },
  );
});

test("ctx.read collects pages through the connected profile and its failures keep their exit codes", async () => {
  const fixture = await dataFixture();
  const reads = [];
  const connected = [];
  const source = (collect) => ({
    collect: async (path) => {
      reads.push(path);
      return collect();
    },
  });
  await inProject(
    {
      ".unverse/pipelines/alpha.mjs": moduleText(fixture, {
        body: `const rows = await ctx.read("src", "accounts?$select=name"); if (rows.length !== 2) throw new Error("rows");`,
      }),
      ".unverse/pipelines/broken.mjs": moduleText(fixture, {
        body: `throw new Error("custom failure");`,
      }),
      ".unverse/pipelines/absent.mjs": moduleText(fixture, {
        body: `await ctx.read("nowhere", "accounts");`,
      }),
      ".unverse/pipelines/invalid.mjs": moduleText(fixture).replace(
        "return { model",
        "return { extra: 1, model",
      ),
    },
    async (root) => {
      const attempt = async (name, collect) => {
        const connect = (profile, environment) => {
          connected.push([environment, profile.url]);
          return environment === "src" ? source(collect) : fixture.client;
        };
        return run(
          ["pipeline", "plan", name, "--env", "dev", "--format", "json"],
          root,
          connect,
        );
      };
      const good = await attempt("alpha", async () => ({
        rows: [{ name: "a" }, { name: "b" }],
        complete: true,
      }));
      assert.equal(good.code, 0, good.errors.join(""));
      assert.deepEqual(reads, ["accounts?$select=name"]);
      assert.deepEqual(connected, [
        ["dev", "https://dev.crm.dynamics.com"],
        ["src", "https://src.crm.dynamics.com"],
      ]);
      for (const [error, code] of [
        ["service", 5],
        ["permission", 4],
        ["authentication", 3],
      ])
        assert.equal(
          (
            await attempt("alpha", async () => {
              throw new DataverseError(error, "denied");
            })
          ).code,
          code,
        );
      const broken = await attempt("broken", async () => undefined);
      assert.equal(broken.code, 2);
      assert.match(
        broken.errors.join("") + broken.output.join(""),
        /Pipeline broken failed: custom failure/,
      );
      assert.equal((await attempt("absent", async () => undefined)).code, 2);
      const invalid = await attempt("invalid", async () => undefined);
      assert.equal(invalid.code, 2);
      assert.match(invalid.output.join(""), /Desired data has a model/);
    },
  );
});

test("the seed pipeline resolves a name inside .unverse/seeds and a path as given", async () => {
  const fixture = await dataFixture();
  const spec = (namespace) =>
    JSON.stringify(
      seedSpec(fixture.model, fixture.mapping, transferData, namespace),
    );
  await inProject(
    {
      ".unverse/seeds/demo.json": spec("inside"),
      "demo.json": spec("outside"),
      "elsewhere/seed.json": spec("inside"),
    },
    async (root) => {
      const plan = async (value) => {
        const result = await run(
          [
            "pipeline",
            "plan",
            "seed",
            "--env",
            "dev",
            "--format",
            "json",
            "--",
            "--seed",
            value,
          ],
          join(root, "deep", "er"),
          () => fixture.client,
        );
        assert.equal(result.code, 0, result.errors.join(""));
        return JSON.parse(result.output[0]).data;
      };
      const named = await plan("demo");
      const byPath = await plan(join(root, "elsewhere", "seed.json"));
      assert.deepEqual(named, byPath);
      assert.notDeepEqual(await plan(join(root, "demo.json")), named);
      const expected = await planDesired(
        fixture.client,
        await seedDesired(JSON.parse(spec("inside"))),
        fixture.environment,
      );
      assert.deepEqual(named, expected);
    },
  );
});

test("the transfer pipeline plans exactly what the transfer planner builds", async () => {
  const fixture = await dataFixture();
  const manifest = await createManifest(
    fixture.model,
    transferData,
    {
      name: "source",
      url: "https://source.crm.dynamics.com",
      organizationId: "source-org",
    },
    fixture.mapping,
  );
  const policy = {
    policyVersion: 1,
    fields: Object.fromEntries(
      fixture.model.entities.flatMap((entity) =>
        entity.columns
          .filter(
            (column) =>
              column.name !== entity.primaryKey &&
              column.references === undefined,
          )
          .map((column) => [
            `${entity.name}.${column.name}`,
            { action: "copy" },
          ]),
      ),
    ),
  };
  await inProject(
    {
      "manifest.json": JSON.stringify(manifest),
      "policy.json": JSON.stringify(policy),
      "mapping.json": JSON.stringify(fixture.mapping),
    },
    async (root) => {
      const result = await run(
        [
          "pipeline",
          "plan",
          "transfer",
          "--env",
          "dev",
          "--format",
          "json",
          "--",
          "--manifest-file",
          join(root, "manifest.json"),
          "--policy-file",
          join(root, "policy.json"),
          "--mapping-file",
          join(root, "mapping.json"),
        ],
        root,
        () => fixture.client,
      );
      assert.equal(result.code, 0, result.errors.join(""));
      const plan = JSON.parse(result.output[0]).data;
      assert.deepEqual(
        plan,
        await planDesired(
          fixture.client,
          await transferDesired(manifest, policy, fixture.mapping),
          fixture.environment,
        ),
      );
      assert.equal(plan.purpose, "transfer");
      assert.equal(plan.policyFingerprint, await fingerprint(policy));
      assert.deepEqual(
        plan.manifest.source.environment,
        manifest.source.environment,
      );
      const missing = await run(
        [
          "pipeline",
          "plan",
          "transfer",
          "--env",
          "dev",
          "--",
          "--manifest-file",
          "m.json",
        ],
        root,
        () => fixture.client,
      );
      assert.equal(missing.code, 2);
      assert.match(missing.errors.join(""), /--mapping-file is required/);
    },
  );
});

test("seed plan and transfer plan no longer exist", async () => {
  for (const [group, verb] of [
    ["seed", "plan"],
    ["transfer", "plan"],
  ]) {
    const result = await run([group, verb, "--env", "dev"], tmpdir());
    assert.equal(result.code, 2);
    assert.match(
      result.errors.join(""),
      new RegExp(`Unknown command ${group}`),
    );
  }
});

test("--on-existing selects how the built-in pipelines treat differing rows", async () => {
  const fixture = await dataFixture();
  await inProject(
    {
      "seed.json": JSON.stringify(
        seedSpec(fixture.model, fixture.mapping, transferData),
      ),
    },
    async (root) => {
      const plan = (...extra) =>
        run(
          [
            "pipeline",
            "plan",
            "seed",
            "--env",
            "dev",
            "--format",
            "json",
            "--",
            "--seed",
            join(root, "seed.json"),
            ...extra,
          ],
          root,
          () => fixture.client,
        );
      const byDefault = await plan();
      assert.equal(JSON.parse(byDefault.output[0]).data.onExisting, "block");
      const update = await plan("--on-existing", "update");
      assert.equal(JSON.parse(update.output[0]).data.onExisting, "update");
      assert.equal((await plan("--on-existing", "overwrite")).code, 2);
    },
  );
});
