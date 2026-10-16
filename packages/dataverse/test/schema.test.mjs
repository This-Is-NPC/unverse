import assert from "node:assert/strict";
import test from "node:test";
import { parseModel, planSchema } from "@unverse/core";
import { applySchema, DataverseClient, inspectSchema } from "../dist/index.js";
import {
  environment,
  mapping,
  model,
  schemaFixture,
} from "./fixtures/schema.mjs";

async function plan(fixture, selected = model) {
  return planSchema(
    selected,
    mapping,
    environment,
    await inspectSchema(fixture.client, mapping),
  );
}

test("schema apply requires confirmation before any write", async () => {
  const fixture = schemaFixture();
  await assert.rejects(
    applySchema(fixture.client, await plan(fixture), environment, false),
    /confirm/,
  );
  assert.equal(fixture.writes.length, 0);
});

test("schema plans reject a foreign environment before writes", async () => {
  const fixture = schemaFixture();
  await assert.rejects(
    applySchema(
      fixture.client,
      await plan(fixture),
      { ...environment, organizationId: "other" },
      true,
    ),
    /another environment/,
  );
  assert.equal(fixture.writes.length, 0);
});

test("schema apply rejects a client endpoint inconsistent with the reviewed context", async () => {
  const fixture = schemaFixture();
  const reviewed = await plan(fixture);
  const other = new DataverseClient(
    "https://other.crm.dynamics.com",
    { getToken: async () => "token" },
    fixture.client.transport,
    { now: () => 0, wait: async () => {} },
  );
  await assert.rejects(
    applySchema(other, reviewed, environment, true),
    /authenticated client/,
  );
  assert.equal(fixture.writes.length, 0);
});

test("schema apply checks the authenticated organization before writes", async () => {
  const fixture = schemaFixture();
  const reviewed = await plan(fixture);
  fixture.client.whoAmI = async () => ({
    organizationId: "other",
    applicationUserId: "app",
    businessUnitId: "unit",
  });
  await assert.rejects(
    applySchema(fixture.client, reviewed, environment, true),
    /authenticated client/,
  );
  assert.equal(fixture.writes.length, 0);
});

test("schema plans reject stale fingerprints before writes", async () => {
  const fixture = schemaFixture();
  const stale = await plan(fixture);
  await applySchema(fixture.client, stale, environment, true);
  fixture.writes.length = 0;
  await assert.rejects(
    applySchema(fixture.client, stale, environment, true),
    /stale/,
  );
  assert.equal(fixture.writes.length, 0);
});

test("applying an already satisfied schema creates no duplicate structure", async () => {
  const fixture = schemaFixture();
  const remaining = await applySchema(
    fixture.client,
    await plan(fixture),
    environment,
    true,
  );
  assert.deepEqual(remaining.operations, []);
  assert.deepEqual(remaining.blocked, []);
  fixture.writes.length = 0;
  await applySchema(fixture.client, remaining, environment, true);
  assert.equal(fixture.writes.length, 0);
});

test("destructive schema changes cannot reach the write transport", async () => {
  const fixture = schemaFixture();
  await applySchema(fixture.client, await plan(fixture), environment, true);
  const reduced = parseModel({
    ...model,
    entities: model.entities.map((entity) => ({
      ...entity,
      columns: entity.columns.filter((column) => column.name !== "amount"),
    })),
  });
  const blocked = await plan(fixture, reduced);
  assert.ok(blocked.blocked.some((entry) => entry.reason.includes("Removing")));
  fixture.writes.length = 0;
  await assert.rejects(
    applySchema(fixture.client, blocked, environment, true),
    /blocked/,
  );
  assert.equal(fixture.writes.length, 0);
});

test("unsupported types and model properties cannot disappear", () => {
  assert.throws(
    () =>
      parseModel({
        ...model,
        entities: [
          {
            ...model.entities[0],
            columns: [
              ...model.entities[0].columns,
              { name: "money", type: "money", nullable: true },
            ],
          },
        ],
      }),
    /Unsupported/,
  );
  assert.throws(() => parseModel({ ...model, ignored: true }), /Unknown/);
});

test("unknown metadata blocks compatibility instead of appearing equivalent", async () => {
  const fixture = schemaFixture();
  await applySchema(fixture.client, await plan(fixture), environment, true);
  fixture.entities
    .get("uv_parent")
    .columns.find(
      (column) => column.LogicalName === "uv_amount",
    ).AttributeType = "Money";
  const result = await plan(fixture);
  assert.ok(result.blocked.some((entry) => entry.path === "parent.amount"));
});

test("schema provisions local choices and multiline without losing options", async () => {
  const fixture = schemaFixture();
  const extended = parseModel({
    ...model,
    entities: model.entities.map((entity) => ({
      ...entity,
      columns: [
        ...entity.columns,
        { name: "notes", type: "multiline", nullable: true, maxLength: 8000 },
        {
          name: "status",
          type: "choice",
          nullable: true,
          options: [
            { value: 1, label: "Open" },
            { value: 2, label: "Closed" },
          ],
        },
      ],
    })),
  });
  const result = await applySchema(
    fixture.client,
    await plan(fixture, extended),
    environment,
    true,
  );
  assert.deepEqual(result.blocked, []);
  fixture.entities
    .get("uv_parent")
    .columns.find((column) => column.LogicalName === "uv_status")
    .OptionSet.Options.pop();
  assert.ok(
    (await plan(fixture, extended)).blocked.some(
      (entry) => entry.path === "parent.status",
    ),
  );
});

test("external relationships require a verified target primary key", async () => {
  const fixture = schemaFixture();
  const extended = parseModel({
    ...model,
    entities: model.entities.map((entity) => ({
      ...entity,
      columns: [
        ...entity.columns,
        {
          name: "user",
          type: "uuid",
          nullable: true,
          externalReference: {
            table: "systemuser",
            primaryKey: "systemuserid",
          },
        },
      ],
    })),
  });
  const unsafe = await plan(fixture, extended);
  assert.ok(
    unsafe.blocked.some((entry) => entry.reason.includes("External target")),
  );
  await assert.rejects(
    applySchema(fixture.client, unsafe, environment, true),
    /blocked|stale/,
  );
  assert.equal(fixture.writes.length, 0);
});
