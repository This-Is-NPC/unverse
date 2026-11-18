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
    await inspectSchema(fixture.client, mapping, selected),
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
    .columns.find(
      (column) => column.LogicalName === "uv_status",
    ).OptionSet.Options[0].Label.LocalizedLabels[0].Label = "Changed";
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

const relationModel = parseModel({
  modelVersion: 1,
  entities: [
    {
      name: "child",
      primaryKey: "id",
      primaryName: "name",
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "name", type: "text", nullable: false, maxLength: 50 },
        { name: "parent", type: "uuid", nullable: true, references: "parent" },
      ],
    },
    ...model.entities,
  ],
});

test("apply waits for created metadata to be visible before dependent writes", async () => {
  const fixture = schemaFixture({ lag: 3 });
  const reviewed = await plan(fixture, relationModel);
  const result = await applySchema(fixture.client, reviewed, environment, true);
  assert.deepEqual(fixture.early, []);
  assert.deepEqual(result.operations, []);
  assert.ok(fixture.clock.now() > 0);
});

test("apply reports created metadata that never becomes visible", async () => {
  const fixture = schemaFixture({ lag: Number.POSITIVE_INFINITY });
  await assert.rejects(
    applySchema(
      fixture.client,
      await plan(fixture, relationModel),
      environment,
      true,
    ),
    /not visible/,
  );
  assert.equal(fixture.writes.length, 1);
});

const keyedModel = parseModel({
  ...model,
  entities: model.entities.map((entity) => ({
    ...entity,
    columns: [
      ...entity.columns,
      { name: "code", type: "text", nullable: false, maxLength: 20 },
    ],
    keys: [{ name: "by_code", columns: ["code"] }],
  })),
});

test("alternate keys are created after their columns and wait for an active index", async () => {
  const fixture = schemaFixture({ lag: 2, indexLag: 5 });
  const result = await applySchema(
    fixture.client,
    await plan(fixture, keyedModel),
    environment,
    true,
  );
  assert.deepEqual(fixture.early, []);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.unverified, []);
  const write = fixture.writes.at(-1);
  assert.equal(write.path, "EntityDefinitions(LogicalName='uv_parent')/Keys");
  assert.equal(write.body.SchemaName, "uv_by_code");
  assert.deepEqual(write.body.KeyAttributes, ["uv_code"]);
  assert.equal(write.headers["MSCRM.SolutionUniqueName"], "UnverseFixture");
  assert.equal(
    fixture.writes.filter((entry) => entry.path.endsWith("/Keys")).length,
    1,
  );
  assert.deepEqual(
    (await inspectSchema(fixture.client, mapping)).entities[0].keys,
    [{ name: "uv_by_code", columns: ["uv_code"], indexStatus: "Active" }],
  );
});

test("a key whose index is not active by the deadline is reported unverified", async () => {
  const fixture = schemaFixture({ indexLag: Number.POSITIVE_INFINITY });
  const result = await applySchema(
    fixture.client,
    await plan(fixture, keyedModel),
    environment,
    true,
  );
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.unverified, [
    {
      path: "parent.keys.by_code",
      reason: "The key index status is Pending, not Active.",
    },
  ]);
});

test("existing keys are never changed or removed", async () => {
  const fixture = schemaFixture();
  await applySchema(
    fixture.client,
    await plan(fixture, keyedModel),
    environment,
    true,
  );
  const keys = fixture.entities.get("uv_parent").keys;
  const other = { SchemaName: "other_key", KeyAttributes: ["name"] };
  keys.push(other);
  assert.deepEqual((await plan(fixture, keyedModel)).blocked, []);
  keys.pop();
  const wider = parseModel({
    ...keyedModel,
    entities: keyedModel.entities.map((entity) => ({
      ...entity,
      keys: [{ name: "by_code", columns: ["code", "name"] }],
    })),
  });
  const renamed = parseModel({
    ...keyedModel,
    entities: keyedModel.entities.map((entity) => ({
      ...entity,
      keys: [{ name: "by_other", columns: ["code"] }],
    })),
  });
  const reduced = parseModel({
    ...keyedModel,
    entities: keyedModel.entities.map(({ keys: _keys, ...entity }) => entity),
  });
  for (const [selected, reason] of [
    [wider, "changing a key is blocked"],
    [renamed, "renaming a key is blocked"],
    [reduced, "Removing an existing custom key"],
  ]) {
    const blocked = await plan(fixture, selected);
    assert.ok(
      blocked.blocked.some((entry) => entry.reason.includes(reason)),
      reason,
    );
    assert.ok(!blocked.operations.some((entry) => entry.kind === "create-key"));
    fixture.writes.length = 0;
    await assert.rejects(
      applySchema(fixture.client, blocked, environment, true),
      /blocked/,
    );
    assert.equal(fixture.writes.length, 0);
  }
});

test("apply reports a created key that never becomes visible", async () => {
  const fixture = schemaFixture({ keyLag: Number.POSITIVE_INFINITY });
  await assert.rejects(
    applySchema(
      fixture.client,
      await plan(fixture, keyedModel),
      environment,
      true,
    ),
    /not visible/,
  );
});

const statusModel = (options) =>
  parseModel({
    ...model,
    entities: model.entities.map((entity) => ({
      ...entity,
      columns: [
        ...entity.columns,
        { name: "status", type: "choice", nullable: true, options },
      ],
    })),
  });
const open = { value: 1, label: "Open" };
const closed = { value: 2, label: "Closed" };

test("choice options absent in Dataverse are added to the solution", async () => {
  const fixture = schemaFixture();
  await applySchema(
    fixture.client,
    await plan(fixture, statusModel([open, closed])),
    environment,
    true,
  );
  const archived = { value: 7, label: "Archived" };
  const reviewed = await plan(fixture, statusModel([open, closed, archived]));
  assert.deepEqual(reviewed.blocked, []);
  assert.deepEqual(reviewed.operations, [
    {
      kind: "add-option",
      entity: "parent",
      column: "status",
      value: 7,
      label: "Archived",
    },
  ]);
  fixture.writes.length = 0;
  const result = await applySchema(fixture.client, reviewed, environment, true);
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.blocked, []);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].path, "InsertOptionValue");
  assert.deepEqual(fixture.writes[0].body, {
    EntityLogicalName: "uv_parent",
    AttributeLogicalName: "uv_status",
    Value: 7,
    Label: { LocalizedLabels: [{ Label: "Archived", LanguageCode: 1033 }] },
    SolutionUniqueName: "UnverseFixture",
  });
  assert.equal(
    fixture.writes[0].headers["MSCRM.SolutionUniqueName"],
    "UnverseFixture",
  );
});

test("choice label changes, value changes, and removals stay blocked", async () => {
  const fixture = schemaFixture();
  await applySchema(
    fixture.client,
    await plan(fixture, statusModel([open, closed])),
    environment,
    true,
  );
  for (const options of [
    [open, { value: 2, label: "Done" }],
    [open, { value: 5, label: "Closed" }],
    [open],
    [open, { value: 3, label: "Closed" }, { value: 2, label: "Done" }],
    [
      { value: 1, label: "Closed" },
      { value: 2, label: "Open" },
    ],
  ]) {
    const blocked = await plan(fixture, statusModel(options));
    assert.ok(
      blocked.blocked.some((entry) => entry.path === "parent.status"),
      JSON.stringify(options),
    );
    assert.deepEqual(blocked.operations, []);
  }
});

test("blocked column removals record whether the column holds data", async () => {
  const wide = parseModel({
    ...model,
    entities: model.entities.map((entity) => ({
      ...entity,
      columns: [
        ...entity.columns,
        { name: "notes", type: "multiline", nullable: true, maxLength: 500 },
        { name: "status", type: "choice", nullable: true, options: [open] },
      ],
    })),
  });
  const fixture = schemaFixture({
    rows: { uv_parent: [{ uv_amount: "1.00", uv_day: null }] },
    denied: ["uv_status"],
  });
  await applySchema(
    fixture.client,
    await plan(fixture, wide),
    environment,
    true,
  );
  fixture.writes.length = 0;
  const reduced = parseModel({
    ...model,
    entities: model.entities.map((entity) => ({
      ...entity,
      columns: entity.columns.filter(
        (column) => !["amount", "day", "count"].includes(column.name),
      ),
    })),
  });
  const blocked = Object.fromEntries(
    (await plan(fixture, reduced)).blocked.map((entry) => [entry.path, entry]),
  );
  assert.equal(blocked["parent.uv_amount"].holdsData, true);
  assert.equal(blocked["parent.uv_day"].holdsData, false);
  assert.equal(blocked["parent.uv_count"].holdsData, false);
  assert.equal(blocked["parent.uv_notes"].holdsData, "unknown");
  assert.match(blocked["parent.uv_notes"].evidence, /cannot be filtered/);
  assert.equal(blocked["parent.uv_status"].holdsData, "unknown");
  assert.match(blocked["parent.uv_status"].evidence, /permission/);
  assert.match(blocked["parent.uv_amount"].evidence, /\$top=1 returned a row/);
  assert.equal(fixture.probes.length, 4);
  assert.ok(
    fixture.probes.every(
      (search) =>
        search.includes("%24select=uv_parentid") &&
        search.includes("ne+null") &&
        search.includes("%24top=1"),
    ),
  );
  assert.deepEqual(fixture.writes, []);
});
