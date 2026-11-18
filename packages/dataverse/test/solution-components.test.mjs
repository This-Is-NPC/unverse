import assert from "node:assert/strict";
import test from "node:test";
import { parseMapping, planSchema } from "@unverse/core";
import { applySchema, inspectSchema } from "../dist/index.js";
import {
  environment,
  solutionComponentFixture as fixture,
  model,
} from "./fixtures/schema.mjs";

const base = { prefix: "uv", solution: "UnverseFixture" };
const variable = {
  schemaName: "uv_ApiUrl",
  displayName: "API URL",
  type: "text",
  defaultValue: "https://private.example",
};
const reference = {
  displayName: "Office 365-Users",
  connector: "shared_office365users",
};
const mapping = parseMapping({
  ...base,
  environmentVariables: [variable],
  connectionReferences: [reference],
});

async function plan(state, selected = mapping) {
  return planSchema(
    model,
    selected,
    environment,
    await inspectSchema(state.client, selected, model),
  );
}

test("solution component mappings validate prefixes, names and types", () => {
  const invalid = (components, pattern) =>
    assert.throws(() => parseMapping({ ...base, ...components }), pattern);
  invalid(
    { environmentVariables: [{ ...variable, schemaName: "other_ApiUrl" }] },
    /prefix/,
  );
  invalid(
    {
      environmentVariables: [
        variable,
        { ...variable, schemaName: "uv_apiurl" },
      ],
    },
    /unique/,
  );
  invalid({ environmentVariables: [{ ...variable, type: "secret" }] }, /text/);
  invalid({ environmentVariables: [{ ...variable, extra: 1 }] }, /Unknown/);
  invalid(
    {
      connectionReferences: [
        reference,
        { ...reference, displayName: "Office365Users" },
      ],
    },
    /unique/,
  );
  invalid(
    { connectionReferences: [{ ...reference, connector: "" }] },
    /connector/,
  );
  invalid(
    { connectionReferences: [{ ...reference, displayName: " - " }] },
    /display name/,
  );
});

test("connection reference names drop hyphens and whitespace but keep casing", async () => {
  const state = fixture();
  const result = await plan(state);
  assert.ok(
    result.operations.some(
      (operation) =>
        operation.kind === "create-connection-reference" &&
        operation.logicalName === "uv_Office365Users",
    ),
  );
});

test("solution components are created when absent and satisfied when equal", async () => {
  const state = fixture();
  const result = await plan(state);
  assert.deepEqual(
    result.operations.filter(
      (operation) =>
        operation.kind.includes("create-env") ||
        operation.kind.includes("create-conn"),
    ),
    [
      { kind: "create-environment-variable", schemaName: "uv_ApiUrl" },
      { kind: "create-connection-reference", logicalName: "uv_Office365Users" },
    ],
  );
  const remaining = await applySchema(state.client, result, environment, true);
  assert.deepEqual(remaining.operations, []);
  assert.deepEqual(remaining.blocked, []);
});

test("differing environment variables and connectors block without modification", async () => {
  const state = fixture();
  await applySchema(state.client, await plan(state), environment, true);
  const before = state.writes.length;
  state.definitions.get("uv_ApiUrl").defaultvalue = "https://other.example";
  state.references.get("uv_Office365Users").connectorid =
    "/providers/Microsoft.PowerApps/apis/shared_other";
  const result = await plan(state);
  assert.deepEqual(
    result.blocked.map((entry) => entry.path),
    [
      "environmentVariables.uv_ApiUrl",
      "connectionReferences.uv_Office365Users",
    ],
  );
  await assert.rejects(
    applySchema(state.client, result, environment, true),
    /blocked/,
  );
  assert.equal(state.writes.length, before);
  assert.equal(
    state.definitions.get("uv_ApiUrl").defaultvalue,
    "https://other.example",
  );
});

test("component creation uses the solution header and writes no values or connections", async () => {
  const state = fixture();
  await applySchema(state.client, await plan(state), environment, true);
  const writes = state.writes.filter((write) =>
    ["environmentvariabledefinitions", "connectionreferences"].includes(
      write.path,
    ),
  );
  assert.equal(writes.length, 2);
  for (const write of writes)
    assert.equal(write.headers["MSCRM.SolutionUniqueName"], "UnverseFixture");
  assert.deepEqual(writes[0].body, {
    schemaname: "uv_ApiUrl",
    displayname: "API URL",
    type: 100000000,
    defaultvalue: "https://private.example",
  });
  assert.deepEqual(writes[1].body, {
    connectionreferencelogicalname: "uv_Office365Users",
    connectionreferencedisplayname: "Office 365-Users",
    connectorid: "/providers/Microsoft.PowerApps/apis/shared_office365users",
  });
  assert.ok(
    state.reads.every((url) => !url.includes("environmentvariablevalues")),
  );
  assert.ok(
    state.writes.every((write) => write.path !== "environmentvariablevalues"),
  );
});

test("plans never echo an existing default value", async () => {
  const state = fixture();
  await applySchema(state.client, await plan(state), environment, true);
  state.definitions.get("uv_ApiUrl").defaultvalue = "https://hidden.example";
  const serialized = JSON.stringify(await plan(state));
  assert.ok(!serialized.includes("hidden.example"));
  const { defaultValue: _ignored, ...withoutDefault } = variable;
  const unset = JSON.stringify(
    await plan(
      state,
      parseMapping({ ...base, environmentVariables: [withoutDefault] }),
    ),
  );
  assert.ok(!unset.includes("hidden.example"));
});

test("environment variables differing in type or display name block", async () => {
  const state = fixture();
  await applySchema(state.client, await plan(state), environment, true);
  const existing = state.definitions.get("uv_ApiUrl");
  existing.type = 100000005;
  assert.equal((await plan(state)).blocked.length, 1);
  existing.type = 100000000;
  existing.displayname = "Other";
  assert.equal((await plan(state)).blocked.length, 1);
});

test("a variable without a default is satisfied by a definition without one", async () => {
  const state = fixture();
  const { defaultValue: _ignored, ...withoutDefault } = variable;
  const selected = parseMapping({
    ...base,
    environmentVariables: [withoutDefault],
  });
  state.definitions.set("uv_ApiUrl", {
    schemaname: "uv_ApiUrl",
    displayname: "API URL",
    type: 100000000,
    defaultvalue: null,
  });
  const result = await plan(state, selected);
  assert.deepEqual(result.blocked, []);
  assert.ok(
    result.operations.every(
      (operation) => operation.kind !== "create-environment-variable",
    ),
  );
});
