import assert from "node:assert/strict";
import test from "node:test";

import { DataverseClient, DataverseError } from "../dist/index.js";

const success = JSON.stringify({
  OrganizationId: "org",
  UserId: "app",
  BusinessUnitId: "unit",
});

test("requests a token for the selected environment", async () => {
  const scopes = [];
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    {
      getToken: async (scope) => {
        scopes.push(scope);
        return "token";
      },
    },
    { get: async () => response(200, success) },
    { wait: async () => {}, now: () => 0 },
  );
  assert.equal((await client.whoAmI()).applicationUserId, "app");
  assert.deepEqual(scopes, ["https://dev.crm.dynamics.com/.default"]);
});

test("prevents API calls after authentication fails", async () => {
  let calls = 0;
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    {
      getToken: async () => {
        throw new Error("denied");
      },
    },
    {
      get: async () => {
        calls += 1;
        return response(200, success);
      },
    },
    { wait: async () => {}, now: () => 0 },
  );
  await assert.rejects(client.whoAmI(), DataverseError);
  assert.equal(calls, 0);
});

test("retries safe reads and retains service context after exhaustion", async () => {
  const waits = [];
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "token" },
    {
      get: async () =>
        response(503, JSON.stringify({ error: { message: "busy" } }), {
          "retry-after": "2",
        }),
    },
    { wait: async (milliseconds) => waits.push(milliseconds), now: () => 0 },
  );
  await assert.rejects(client.whoAmI(), /busy/);
  assert.deepEqual(waits, [2000, 2000]);
});

function response(status, body, headers = {}) {
  return { status, body, headers };
}

function clientFor(get, wait = async () => {}) {
  return new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "sensitive-token" },
    { get },
    { wait, now: () => 0 },
  );
}

test("recognizes a permission error payload even with a successful HTTP status", async () => {
  const client = clientFor(async () =>
    response(
      200,
      JSON.stringify({
        error: { code: "0x80040220", message: "Missing privilege" },
      }),
    ),
  );
  await assert.rejects(
    client.whoAmI(),
    (error) =>
      error.code === "permission" && error.serviceCode === "0x80040220",
  );
});

test("classifies malformed JSON as a service error", async () => {
  await assert.rejects(
    clientFor(async () => response(200, "not JSON")).whoAmI(),
    (error) => error.code === "service",
  );
});

test("retries transport failures without losing their context or leaking a token", async () => {
  let calls = 0;
  const client = clientFor(async () => {
    calls += 1;
    throw new Error("connection lost: sensitive-token");
  });
  await assert.rejects(
    client.whoAmI(),
    (error) =>
      error.code === "service" &&
      error.message === "connection lost: [REDACTED]",
  );
  assert.equal(calls, 3);
});

test("honors an HTTP date Retry-After without a real wait", async () => {
  const waits = [];
  let calls = 0;
  const client = clientFor(
    async () => {
      calls += 1;
      return calls === 1
        ? response(429, "{}", {
            "Retry-After": "Thu, 01 Jan 1970 00:00:02 GMT",
          })
        : response(200, success);
    },
    async (delay) => {
      waits.push(delay);
    },
  );
  await client.whoAmI();
  assert.deepEqual(waits, [2000]);
});

test("does not retry beyond the delay budget", async () => {
  const waits = [];
  const client = clientFor(
    async () => response(429, "{}", { "retry-after": "3600" }),
    async (delay) => {
      waits.push(delay);
    },
  );
  await assert.rejects(client.whoAmI(), (error) => error.httpStatus === 429);
  assert.deepEqual(waits, []);
});

test("requests the configured OData page size", async () => {
  const requests = [];
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "token" },
    {
      get: async (_url, headers) => {
        requests.push(headers);
        return response(200, success);
      },
    },
    { now: () => 0, wait: async () => {} },
    1,
  );
  await client.whoAmI();
  assert.equal(requests[0].Prefer, "odata.maxpagesize=1");
});
