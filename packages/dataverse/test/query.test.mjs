import assert from "node:assert/strict";
import test from "node:test";
import { query, tables } from "../dist/index.js";
import { queryFixture, table } from "./fixtures/query.mjs";

test("discovers table names, primary keys, labels, and intersect flags", async () => {
  assert.deepEqual(await tables(queryFixture().client), [
    {
      logicalName: "account",
      entitySet: "accounts",
      primaryKey: "accountid",
      displayName: "Account",
      intersect: false,
    },
  ]);
});

test("searches metadata locally without unsupported contains", async () => {
  const { client, calls } = queryFixture({
    tables: [
      table,
      {
        ...table,
        LogicalName: "contact",
        EntitySetName: "contacts",
        DisplayName: { UserLocalizedLabel: { Label: "Contact" } },
      },
    ],
  });
  let result;
  await assert.doesNotReject(async () => {
    result = await tables(client, "ACCOUNT");
  });
  assert.deepEqual(
    result.map((definition) => definition.logicalName),
    ["account"],
  );
  assert.equal(new URL(calls[0]).searchParams.has("$filter"), false);
});

test("table search resolves display labels and entity sets", async () => {
  assert.equal(
    (await tables(queryFixture().client, "ACCOUNTS"))[0].logicalName,
    "account",
  );
  const fixture = queryFixture({
    tables: [
      { ...table, DisplayName: { UserLocalizedLabel: { Label: "Customer" } } },
    ],
  });
  assert.deepEqual(
    (await tables(fixture.client, "CUSTOMER")).map((row) => row.logicalName),
    ["account"],
  );
});

test("resolves the entity set before reading selected columns", async () => {
  const { client, calls } = queryFixture();
  const result = await query(client, {
    table: "account",
    select: ["accountid", "name"],
    filter: "name eq 'Synthetic Account'",
    orderBy: "name desc",
    limit: 1,
  });
  assert.equal(result.complete, false);
  assert.equal(result.rows.length, 1);
  const url = new URL(calls[1]);
  assert.equal(url.pathname, "/api/data/v9.2/accounts");
  assert.equal(url.searchParams.get("$select"), "accountid,name");
  assert.equal(url.searchParams.get("$filter"), "name eq 'Synthetic Account'");
  assert.equal(url.searchParams.get("$orderby"), "name desc");
});

test("rejects unsupported tables instead of inventing an entity set", async () => {
  await assert.rejects(
    query(
      queryFixture({ tables: [{ ...table, EntitySetName: null }] }).client,
      { table: "account", select: ["accountid"] },
    ),
    (error) => error.code === "unsupported",
  );
});

test("rejects invalid query columns before requesting metadata", async () => {
  const { client, calls } = queryFixture();
  await assert.rejects(
    query(client, { table: "account", select: ["name&$expand=contacts"] }),
    (error) => error.code === "invalid-input",
  );
  assert.deepEqual(calls, []);
});
