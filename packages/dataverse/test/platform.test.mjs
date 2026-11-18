import assert from "node:assert/strict";
import test from "node:test";
import { PlatformClient, platformApps, platformFlows } from "../dist/index.js";
import {
  appsFirstPage,
  appsLastPage,
  appsPath,
  flowsPage,
  flowsPath,
  platformFixture,
} from "./fixtures/platform.mjs";

test("platform reads request a token for the Power Platform scope", async () => {
  const { client, tokens, requests } = platformFixture({
    routes: { [flowsPath]: [flowsPage] },
  });
  await platformFlows(client);
  assert.deepEqual(tokens, ["https://api.powerplatform.com/.default"]);
  assert.equal(
    requests[0].url,
    `https://api.powerplatform.com${flowsPath}?api-version=2024-10-01`,
  );
  assert.equal(requests[0].headers.Authorization, "Bearer platform-token");
});

test("platform apps follow nextLink to the last page", async () => {
  const { client, requests } = platformFixture({
    routes: { [appsPath]: [appsFirstPage, appsLastPage] },
  });
  const rows = await platformApps(client);
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /skiptoken=page2/);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Alpha Canvas", "Zeta Canvas"],
  );
});

test("platform rows keep fields the API does not provide absent", async () => {
  const apps = platformFixture({ routes: { [appsPath]: [appsLastPage] } });
  assert.deepEqual(await platformApps(apps.client), [
    {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Alpha Canvas",
      source: "platform",
    },
  ]);
  const flows = platformFixture({ routes: { [flowsPath]: [flowsPage] } });
  const rows = await platformFlows(flows.client);
  assert.deepEqual(rows[0], {
    id: "00000000-0000-0000-0000-000000000008",
    name: "Bare Flow",
    source: "platform",
    kind: "cloud-flow",
  });
  assert.equal(rows[1].state, 1);
  assert.equal(rows[1].uniqueName, "flow_internal");
});

test("platform permission failures are errors, not empty lists", async () => {
  const { client } = platformFixture({
    routes: {},
    status: { [flowsPath]: 403 },
  });
  await assert.rejects(
    platformFlows(client),
    (error) => error.code === "permission" && error.httpStatus === 403,
  );
});

test("platform rejects a continuation outside the Power Platform API", async () => {
  const { client, requests } = platformFixture({
    routes: {
      [appsPath]: [{ value: [], nextLink: "https://attacker.invalid/apps" }],
    },
  });
  await assert.rejects(
    platformApps(client),
    (error) => error.code === "service",
  );
  assert.equal(requests.length, 1);
});

test("platform treats 204 as an empty complete list", async () => {
  const empty = {
    get: async () => ({ status: 204, headers: {}, body: "" }),
  };
  const direct = new PlatformClient(
    "env",
    { getToken: async () => "t" },
    empty,
    { now: () => 0, wait: async () => {} },
  );
  assert.deepEqual(await platformFlows(direct), []);
});
