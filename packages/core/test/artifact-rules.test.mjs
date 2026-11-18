import assert from "node:assert/strict";
import test from "node:test";
import {
  ArtifactDeclarationError,
  checkArtifacts,
  parseArtifactDeclarations,
  selectArtifacts,
} from "../dist/index.js";

const file = (types, rules = {}) =>
  parseArtifactDeclarations({ artifactsVersion: 1, types, rules });

const item = (name, fields = {}) => ({
  type: "canvas-app",
  id: `id-${name}`,
  name,
  source: "dataverse",
  ...fields,
});

const nameRule = (name, ...names) => {
  const declarations = file({ t: { from: "canvas-app" } }, { t: { name } });
  const outcome = checkArtifacts(
    declarations,
    new Map([["t", names.map((value) => item(value))]]),
  );
  return names.map(
    (value) => !outcome.violations.some((entry) => entry.item.name === value),
  );
};

test("placeholders match the declared character kinds", () => {
  assert.deepEqual(nameRule("{app}", "a", "a-b c"), [true, true]);
  assert.deepEqual(nameRule("wcdc_{app}", "wcdc_x", "wcdc_", "WCDC_x"), [
    true,
    false,
    false,
  ]);
  assert.deepEqual(nameRule("wcdc_{e:lower}", "wcdc_ab", "wcdc_aB"), [
    true,
    false,
  ]);
  assert.deepEqual(nameRule("{e:upper}-x", "AB-x", "Ab-x"), [true, false]);
  assert.deepEqual(nameRule("EP{n:digits}", "EP12", "EP", "EPx"), [
    true,
    false,
    false,
  ]);
  assert.deepEqual(
    nameRule(
      "sr-EP{ep:digits:7}-{app}-{role}",
      "sr-EP1234567-a-b-c",
      "sr-EP12-a-b",
      "sr-EP12345678-a-b",
    ),
    [true, false, false],
  );
  assert.deepEqual(nameRule("{a}-{a}", "x-x", "x-y"), [true, false]);
  assert.deepEqual(nameRule("a.b", "a.b", "axb"), [true, false]);
});

test("placeholders never match across literal text", () => {
  assert.deepEqual(nameRule("{a}.zip", "x.zip", "x.zip.bak"), [true, false]);
  assert.deepEqual(nameRule("pre-{a}", "pre-x", "xpre-x"), [true, false]);
});

test("where filters match globs, lists and booleans", () => {
  const declarations = file({
    glob: { from: "canvas-app", where: { name: "wcdc_kpo*" } },
    any: { from: "canvas-app", where: { name: ["a", "b*"] } },
    flag: { from: "canvas-app", where: { managed: false } },
    kind: { from: "canvas-app", where: { kind: "code-app", managed: true } },
  });
  const items = [
    item("wcdc_kpo1", { managed: false, kind: "code-app" }),
    item("a", { managed: true, kind: "code-app" }),
    item("bb", { managed: true, kind: "classic" }),
    item("WCDC_KPO2", { managed: false, kind: "classic" }),
  ];
  const names = (type) =>
    selectArtifacts(
      declarations.types.find((entry) => entry.type === type),
      items,
    ).selected.map((entry) => entry.name);
  assert.deepEqual(names("glob"), ["wcdc_kpo1"]);
  assert.deepEqual(names("any"), ["a", "bb"]);
  assert.deepEqual(names("flag"), ["wcdc_kpo1", "WCDC_KPO2"]);
  assert.deepEqual(names("kind"), ["a"]);
});

test("a declaration that cannot be evaluated fails at load", () => {
  const load = (document) => () => parseArtifactDeclarations(document);
  const fails = (document, pattern) =>
    assert.throws(load(document), (error) => {
      assert.ok(error instanceof ArtifactDeclarationError);
      assert.match(error.message, pattern);
      return true;
    });
  fails({ artifactsVersion: 2 }, /artifactsVersion/);
  fails({ artifactsVersion: 1, extra: 1 }, /unknown key extra/);
  fails(
    { artifactsVersion: 1, types: { x: { from: "nonsense" } } },
    /from must be one of/,
  );
  fails(
    {
      artifactsVersion: 1,
      types: { x: { from: "table", where: { kind: "a" } } },
    },
    /table does not provide kind/,
  );
  fails(
    {
      artifactsVersion: 1,
      types: { x: { from: "connector", where: { solution: "a" } } },
    },
    /connector does not provide solution/,
  );
  fails(
    { artifactsVersion: 1, types: { x: { from: "table", extra: 1 } } },
    /unknown key extra/,
  );
  fails(
    { artifactsVersion: 1, types: { table: { from: "table" } } },
    /collides with the built-in type/,
  );
  fails(
    { artifactsVersion: 1, types: { X: { from: "table" } } },
    /Type name X/,
  );
  fails(
    {
      artifactsVersion: 1,
      types: { x: { from: "table", where: { name: 3 } } },
    },
    /non-empty list of non-empty strings/,
  );
  fails(
    {
      artifactsVersion: 1,
      types: { x: { from: "canvas-app", where: { managed: "no" } } },
    },
    /must be a boolean/,
  );
  fails(
    { artifactsVersion: 1, rules: { ghost: { name: "{a}" } } },
    /no declared type/,
  );
  fails(
    { artifactsVersion: 1, rules: { "canvas-app": { name: "{a}" } } },
    /no declared type/,
  );
  const rule = (value, from = "canvas-app") => ({
    artifactsVersion: 1,
    types: { t: { from } },
    rules: { t: value },
  });
  for (const pattern of [
    "{a",
    "a}",
    "{}",
    "{a:weird}",
    "{a:lower:3}",
    "{a b}",
    "{a:digits:0}",
  ])
    fails(rule({ name: pattern }), /placeholder|unmatched|width/);
  fails(rule({ name: "{a}{a:lower}" }), /two different kinds/);
  fails(rule({ name: "" }), /non-empty pattern/);
  fails(
    rule({ displayName: "{a}" }, "security-role"),
    /does not provide displayName/,
  );
  fails(rule({ managed: "yes" }), /must be a boolean/);
  fails(rule({ solution: "sometimes" }), /required/);
  fails(rule({ publisher: [] }), /non-empty list/);
  fails(rule({ colour: "red" }), /unknown key colour/);
  fails(rule({ owner: ["x"] }, "table"), /does not provide owner/);
});

const solution = (uniqueName, publisher, managed = false) => ({
  uniqueName,
  managed,
  publisher,
});

test("solution and publisher rules count unmanaged solutions", () => {
  const declarations = file(
    {
      required: { from: "canvas-app" },
      forbidden: { from: "canvas-app" },
      listed: { from: "canvas-app" },
      publisher: { from: "canvas-app" },
    },
    {
      required: { solution: "required" },
      forbidden: { solution: "forbidden" },
      listed: { solution: ["a", "m"] },
      publisher: { publisher: ["wcdc", "uv"] },
    },
  );
  const items = [
    item("none", { solutions: [] }),
    item("one", { solutions: [solution("a", "wcdc")] }),
    item("two", { solutions: [solution("a", "wcdc"), solution("b", "other")] }),
    item("managed", { solutions: [solution("m", "wcdc", true)] }),
  ];
  const outcome = checkArtifacts(
    declarations,
    new Map(
      ["required", "forbidden", "listed", "publisher"].map((name) => [
        name,
        items,
      ]),
    ),
  );
  assert.equal(outcome.checked, 16);
  assert.deepEqual(outcome.unknown, []);
  const failing = (type) =>
    outcome.violations
      .filter((entry) => entry.type === type)
      .map((entry) => entry.item.name);
  assert.deepEqual(failing("required"), ["none", "managed"]);
  assert.deepEqual(failing("forbidden"), ["one", "two"]);
  assert.deepEqual(failing("listed"), ["none"]);
  assert.deepEqual(failing("publisher"), ["none", "two", "managed"]);
  assert.deepEqual(
    outcome.violations.find(
      (entry) => entry.type === "publisher" && entry.item.name === "two",
    ),
    {
      type: "publisher",
      rule: "publisher",
      item: { id: "id-two", name: "two" },
      expected: ["wcdc", "uv"],
      observed: ["wcdc", "other"],
    },
  );
});

test("a rule checks the display name, owner and managed state", () => {
  const declarations = file(
    { t: { from: "canvas-app" } },
    {
      t: {
        displayName: "{x} app",
        owner: ["00000000-0000-0000-0000-00000000000A"],
        managed: false,
      },
    },
  );
  const outcome = checkArtifacts(
    declarations,
    new Map([
      [
        "t",
        [
          item("good", {
            displayName: "My app",
            owner: "00000000-0000-0000-0000-00000000000a",
            managed: false,
          }),
          item("bad", {
            displayName: "My",
            owner: "00000000-0000-0000-0000-00000000000b",
            managed: true,
          }),
        ],
      ],
    ]),
  );
  assert.deepEqual(
    outcome.violations.map((entry) => [entry.item.name, entry.rule]),
    [
      ["bad", "displayName"],
      ["bad", "owner"],
      ["bad", "managed"],
    ],
  );
});

test("an unknown field is reported, never passed", () => {
  const declarations = file(
    { t: { from: "canvas-app", where: { kind: "code-app" } } },
    { t: { displayName: "{x}", managed: false, solution: "required" } },
  );
  const outcome = checkArtifacts(
    declarations,
    new Map([["t", [item("bare", { kind: "code-app" }), item("undecided")]]]),
  );
  assert.deepEqual(outcome.violations, []);
  assert.equal(outcome.checked, 1);
  assert.deepEqual(
    outcome.unknown.map((entry) => [entry.item.name, entry.rule]),
    [
      ["undecided", "where"],
      ["bare", "displayName"],
      ["bare", "solution"],
      ["bare", "managed"],
    ],
  );
});

test("the documented example declaration loads", async () => {
  const { readFile } = await import("node:fs/promises");
  const declarations = parseArtifactDeclarations(
    JSON.parse(
      await readFile(
        new URL("../../../docs/examples/artifacts.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.deepEqual(
    declarations.types.map((type) => type.type),
    ["code-app", "fixture-table"],
  );
  assert.equal(declarations.rules.size, 2);
});
