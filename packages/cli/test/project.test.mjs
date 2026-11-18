import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runCli } from "../dist/run.js";

const profile = (host) => ({
  url: `https://${host}.crm.dynamics.com`,
  tenantIdEnv: "UNVERSE_TENANT_ID",
  clientIdEnv: "UNVERSE_CLIENT_ID",
  clientSecretEnv: "UNVERSE_CLIENT_SECRET",
});

function writeConfig(directory, host, name = "dev") {
  const path = join(directory, ".unverse", "config.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      configVersion: 1,
      environments: { [name]: profile(host) },
    }),
  );
  return path;
}

async function inProject(body) {
  const root = mkdtempSync(join(tmpdir(), "unverse-project-"));
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function run(args, cwd, env = {}) {
  const output = [];
  const errors = [];
  const code = await runCli(args, {
    readFile: (path) => readFile(path, "utf8"),
    writeFile: async (path, content) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { flag: "wx" });
    },
    fileExists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    cwd,
    env,
    now: () => "2026-10-16T00:00:00.000Z",
    writeOut: (line) => output.push(line),
    writeError: (line) => errors.push(line),
    secrets: [],
  });
  return {
    code,
    document: output.length === 0 ? undefined : JSON.parse(output[0]),
    errors: errors.join(""),
  };
}

const check = ["config", "check", "--format", "json"];

test("discovers .unverse/config.json from a nested directory", async () => {
  await inProject(async (root) => {
    const path = writeConfig(root, "found");
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    const { code, document } = await run([...check, "--env", "dev"], nested);
    assert.equal(code, 0);
    assert.equal(document.environment.url, "https://found.crm.dynamics.com");
    assert.equal(document.data.configuration.path, path);
    assert.ok(
      document.evidence.includes(
        `Configuration ${path} found by searching up from ${nested}.`,
      ),
    );
  });
});

test("the nearest .unverse/config.json wins", async () => {
  await inProject(async (root) => {
    writeConfig(root, "outer");
    const inner = join(root, "inner");
    writeConfig(inner, "inner");
    const { document } = await run([...check, "--env", "dev"], inner);
    assert.equal(document.environment.url, "https://inner.crm.dynamics.com");
  });
});

test("--config beats UNVERSE_CONFIG beats discovery", async () => {
  await inProject(async (root) => {
    writeConfig(root, "discovered");
    const flagged = writeConfig(join(root, "flagged"), "flagged");
    const named = writeConfig(join(root, "named"), "named");
    const env = { UNVERSE_CONFIG: named };
    const byFlag = await run(
      [...check, "--env", "dev", "--config", flagged],
      root,
      env,
    );
    assert.equal(
      byFlag.document.environment.url,
      "https://flagged.crm.dynamics.com",
    );
    assert.ok(
      byFlag.document.evidence.includes(
        `Configuration ${flagged} from --config.`,
      ),
    );
    const byVariable = await run([...check, "--env", "dev"], root, env);
    assert.equal(
      byVariable.document.environment.url,
      "https://named.crm.dynamics.com",
    );
    assert.ok(
      byVariable.document.evidence.includes(
        `Configuration ${named} from UNVERSE_CONFIG.`,
      ),
    );
    const discovered = await run([...check, "--env", "dev"], root);
    assert.equal(
      discovered.document.environment.url,
      "https://discovered.crm.dynamics.com",
    );
  });
});

test("--env beats UNVERSE_ENV and records its origin", async () => {
  await inProject(async (root) => {
    const path = join(root, ".unverse", "config.json");
    writeConfig(root, "one", "dev");
    writeFileSync(
      path,
      JSON.stringify({
        configVersion: 1,
        environments: { dev: profile("dev"), test: profile("test") },
      }),
    );
    const flagged = await run([...check, "--env", "dev"], root, {
      UNVERSE_ENV: "test",
    });
    assert.equal(flagged.document.environment.name, "dev");
    assert.ok(
      flagged.document.evidence.includes("Environment dev from --env."),
    );
    const variable = await run(check, root, { UNVERSE_ENV: "test" });
    assert.equal(variable.document.environment.name, "test");
    assert.ok(
      variable.document.evidence.includes("Environment test from UNVERSE_ENV."),
    );
  });
});

test("a command that needs an environment exits two without one", async () => {
  await inProject(async (root) => {
    writeConfig(root, "found");
    const { code, errors } = await run(["config", "check"], root, {
      UNVERSE_ENV: "",
    });
    assert.equal(code, 2);
    assert.match(errors, /pass --env or set UNVERSE_ENV/);
  });
});

test("a missing configuration exits two naming the search and unverse init", async () => {
  await inProject(async (root) => {
    const { code, errors } = await run(["env", "list"], root);
    assert.equal(code, 2);
    assert.match(errors, /No \.unverse\/config\.json found from /);
    assert.match(errors, /unverse init/);
  });
});

test("init creates the template and nothing else", async () => {
  await inProject(async (root) => {
    const { code, document } = await run(
      ["init", "--confirm", "--format", "json"],
      root,
    );
    assert.equal(code, 0);
    assert.equal(document.data.created, true);
    assert.deepEqual(readdirSync(root), [".unverse"]);
    assert.deepEqual(readdirSync(join(root, ".unverse")), ["config.json"]);
    const template = JSON.parse(
      readFileSync(join(root, ".unverse", "config.json"), "utf8"),
    );
    assert.equal(template.configVersion, 1);
    const checked = await run([...check, "--env", "dev"], root);
    assert.equal(checked.code, 0);
  });
});

test("init is a no-op when the identical template exists", async () => {
  await inProject(async (root) => {
    await run(["init", "--confirm"], root);
    const again = await run(["init", "--confirm", "--format", "json"], root);
    assert.equal(again.code, 0);
    assert.equal(again.document.data.created, false);
  });
});

test("init refuses to overwrite a different file", async () => {
  await inProject(async (root) => {
    const path = writeConfig(root, "mine");
    const before = readFileSync(path, "utf8");
    const { code, errors } = await run(["init", "--confirm"], root);
    assert.equal(code, 2);
    assert.match(errors, /does not overwrite/);
    assert.equal(readFileSync(path, "utf8"), before);
  });
});
