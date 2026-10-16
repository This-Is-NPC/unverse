import assert from "node:assert/strict";
import test from "node:test";
import {
  apps,
  compareEnvironments,
  DataverseClient,
  flows,
  solutionComponents,
  solutions,
  users,
  variables,
} from "../dist/index.js";

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
function fixture(overrides = {}) {
  const requests = [];
  const routes = {
    solutions: [
      {
        solutionid: id(1),
        uniquename: "example",
        friendlyname: "Example App",
        version: "1.0",
        ismanaged: false,
      },
    ],
    solutioncomponents: [
      {
        solutioncomponentid: id(2),
        objectid: id(3),
        componenttype: 80,
        rootcomponentbehavior: 0,
      },
    ],
    canvasapps: [
      {
        canvasappid: id(4),
        name: "canvas_internal",
        displayname: "Canvas Example",
      },
    ],
    appmodules: [
      {
        appmoduleid: id(5),
        name: "Model Example",
        uniquename: "model_internal",
        statecode: 0,
      },
    ],
    workflows: [
      {
        workflowid: id(6),
        name: "Example Flow",
        uniquename: "flow_internal",
        statecode: 1,
      },
    ],
    systemusers: [
      {
        systemuserid: id(7),
        fullname: "Example User",
        internalemailaddress: "test@example.invalid",
        domainname: "domain",
        isdisabled: false,
        _businessunitid_value: id(8),
      },
    ],
    environmentvariabledefinitions: [
      {
        environmentvariabledefinitionid: id(9),
        schemaname: "example_variable",
        displayname: "Example variable",
        type: 100000000,
      },
      {
        environmentvariabledefinitionid: id(10),
        schemaname: "secret_variable",
        displayname: "Secret",
        type: 100000005,
      },
    ],
    environmentvariablevalues: [{ value: "private-not-for-output" }],
    ...overrides,
  };
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "token" },
    {
      get: async (input) => {
        const url = new URL(input);
        requests.push(url);
        const path = url.pathname.split("/").at(-1);
        if (overrides.denied === path)
          return {
            status: 403,
            headers: {},
            body: '{"error":{"message":"Denied"}}',
          };
        const value =
          path === "environmentvariabledefinitions" &&
          url.searchParams.get("$select") === "defaultvalue"
            ? [{ defaultvalue: null }]
            : routes[path];
        assert.ok(value, path);
        return { status: 200, headers: {}, body: JSON.stringify({ value }) };
      },
    },
    { now: () => 0, wait: async () => {} },
  );
  return { client, requests };
}

test("discovery finds display and unique names for both app kinds", async () => {
  const { client } = fixture();
  assert.equal((await apps(client, "all", "example")).length, 2);
  assert.equal(
    (await apps(client, "canvas", "CANVAS_INTERNAL"))[0].kind,
    "canvas",
  );
  assert.equal((await solutions(client, "APP")).length, 1);
  assert.equal((await users(client, "test@"))[0].id, id(7));
  assert.equal((await solutionComponents(client, id(1)))[0].componentType, 80);
});
test("flow discovery restricts reads to cloud flows", async () => {
  const { client, requests } = fixture();
  assert.equal((await flows(client, "FLOW_INTERNAL")).length, 1);
  assert.equal(requests[0].searchParams.get("$filter"), "category eq 5");
});
test("variable inventory masks values and never reads secret overrides", async () => {
  const { client, requests } = fixture();
  const output = await variables(client);
  assert.ok(!JSON.stringify(output).includes("private-not-for-output"));
  assert.ok(
    output.some((row) => row.source === "secret" && row.configured === null),
  );
  assert.equal(
    requests.filter((url) => url.pathname.endsWith("environmentvariablevalues"))
      .length,
    1,
  );
  assert.ok(
    requests.every((url) => !url.searchParams.get("$filter")?.includes(id(10))),
  );
});
test("comparison detects private value differences without exposing values or hashes", async () => {
  const source = fixture({
    environmentvariabledefinitions: [
      {
        environmentvariabledefinitionid: id(9),
        schemaname: "example_variable",
        displayname: "Example",
        type: 100000000,
      },
    ],
  });
  const target = fixture({
    environmentvariabledefinitions: [
      {
        environmentvariabledefinitionid: id(9),
        schemaname: "example_variable",
        displayname: "Example",
        type: 100000000,
      },
    ],
    environmentvariablevalues: [{ value: "different-private" }],
  });
  const report = await compareEnvironments(
    source.client,
    target.client,
    "variables",
  );
  assert.equal(report.equal, false);
  assert.equal(report.differences[0].kind, "variable-value");
  assert.ok(!JSON.stringify(report).includes("private"));
});
test("secret comparisons remain unknown instead of equal", async () => {
  const report = await compareEnvironments(fixture().client, fixture().client);
  assert.equal(report.equal, false);
  assert.deepEqual(report.unknown, ["secret_variable"]);
});
test("denied discovery cannot masquerade as an empty inventory", async () => {
  await assert.rejects(
    apps(fixture({ denied: "canvasapps" }).client),
    (error) => error.code === "permission",
  );
});

test("component comparison uses typed object identities instead of environment-local membership IDs", async () => {
  const source = fixture();
  const target = fixture({
    solutioncomponents: [
      {
        solutioncomponentid: id(20),
        objectid: id(3),
        componenttype: 80,
        rootcomponentbehavior: 0,
      },
    ],
  });
  assert.equal(
    (
      await compareEnvironments(
        source.client,
        target.client,
        "components",
        "example",
      )
    ).equal,
    true,
  );
  const changed = fixture({
    solutioncomponents: [
      {
        solutioncomponentid: id(21),
        objectid: id(30),
        componenttype: 80,
        rootcomponentbehavior: 0,
      },
    ],
  });
  const comparison = await compareEnvironments(
    source.client,
    changed.client,
    "components",
    "example",
  );
  assert.equal(comparison.equal, false);
  assert.equal(comparison.differences[0].kind, "component-membership");
});
