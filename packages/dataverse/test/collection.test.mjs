import assert from "node:assert/strict";
import test from "node:test";
import { DataverseClient } from "../dist/index.js";

function fixture(pages) {
  const calls = [];
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "fixture-token" },
    {
      get: async (url) => {
        calls.push(url);
        const page = pages[calls.length - 1];
        return {
          status: page?.status ?? 200,
          headers: {},
          body: JSON.stringify(page?.body ?? {}),
        };
      },
    },
    { now: () => 0, wait: async () => {} },
  );
  return { client, calls };
}

test("collects all requested pages", async () => {
  const { client, calls } = fixture([
    {
      body: {
        value: [{ id: 1 }],
        "@odata.nextLink":
          "https://dev.crm.dynamics.com/api/data/v9.2/accounts?page=2",
      },
    },
    { body: { value: [{ id: 2 }] } },
  ]);
  assert.deepEqual(await client.collect("accounts"), {
    rows: [{ id: 1 }, { id: 2 }],
    complete: true,
  });
  assert.equal(calls.length, 2);
});

test("rejects cross-origin continuation before sending a token", async () => {
  const { client, calls } = fixture([
    {
      body: {
        value: [],
        "@odata.nextLink": "https://attacker.invalid/api/data/v9.2/accounts",
      },
    },
  ]);
  await assert.rejects(
    client.collect("accounts"),
    (error) => error.code === "service",
  );
  assert.equal(calls.length, 1);
});

test("reports capped results as incomplete", async () => {
  const { client } = fixture([{ body: { value: [{ id: 1 }, { id: 2 }] } }]);
  assert.deepEqual(await client.collect("accounts", 1), {
    rows: [{ id: 1 }],
    complete: false,
  });
});

test("does not return a complete result after a later page fails", async () => {
  const { client } = fixture([
    { body: { value: [], "@odata.nextLink": "accounts?page=2" } },
    { status: 403 },
  ]);
  await assert.rejects(
    client.collect("accounts"),
    (error) => error.code === "permission",
  );
});
