import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyDataPolicy,
  buildSeed,
  normalizeDataset,
  parseModel,
} from "../dist/index.js";
import data from "./fixtures/data.json" with { type: "json" };
import model from "./fixtures/schema.json" with { type: "json" };

export const seed = {
  seedVersion: 1,
  seed: "community-example",
  model,
  mapping: { prefix: "uv", solution: "Fixture" },
  rows: {
    parent: [
      {
        key: "first",
        values: {
          name: "Example",
          amount: "12.34",
          count: 1,
          enabled: true,
          day: "2026-10-17",
          instant: "2026-10-17T12:00:00Z",
        },
      },
    ],
    child: [
      { key: "first", values: { name: "Child", parentid: { key: "first" } } },
    ],
  },
};

test("seed IDs are deterministic and relationships resolve to generated IDs", async () => {
  const first = await buildSeed(seed);
  const repeated = await buildSeed(seed);
  assert.deepEqual(first, repeated);
  assert.equal(first.data.child[0].parentid, first.data.parent[0].id);
  const other = await buildSeed({ ...seed, seed: "different" });
  assert.notEqual(first.data.parent[0].id, other.data.parent[0].id);
});
test("seed rejects duplicate row keys and missing references", async () => {
  await assert.rejects(
    buildSeed({
      ...seed,
      rows: { ...seed.rows, child: [...seed.rows.child, ...seed.rows.child] },
    }),
    /Duplicate seed row key/,
  );
  const changed = structuredClone(seed);
  changed.rows.child[0].values.parentid.key = "missing";
  await assert.rejects(buildSeed(changed), /not found/);
});
test("transfer policy requires every field and replaces sensitive values", () => {
  const parsed = parseModel(model);
  assert.throws(
    () => applyDataPolicy(parsed, data, { policyVersion: 1, fields: {} }),
    /Every/,
  );
  const fields = Object.fromEntries(
    parsed.entities.flatMap((entity) =>
      entity.columns
        .filter(
          (column) =>
            column.name !== entity.primaryKey &&
            column.references === undefined,
        )
        .map((column) => [`${entity.name}.${column.name}`, { action: "copy" }]),
    ),
  );
  fields["parent.name"] = { action: "constant", value: "Anonymous" };
  const output = applyDataPolicy(parsed, data, { policyVersion: 1, fields });
  assert.equal(output.parent[0].name, "Anonymous");
  assert.equal(data.parent[0].name, "Synthetic Parent");
});
test("new schema types reject undeclared choices and external dataset integrity", () => {
  const extended = parseModel({
    ...model,
    entities: model.entities.map((entity) =>
      entity.name === "parent"
        ? {
            ...entity,
            columns: [
              ...entity.columns,
              {
                name: "notes",
                type: "multiline",
                maxLength: 8000,
                nullable: true,
              },
              {
                name: "status",
                type: "choice",
                nullable: false,
                options: [{ value: 1, label: "Open" }],
              },
            ],
          }
        : entity,
    ),
  });
  const values = structuredClone(data);
  values.parent[0].notes = "line one\nline two";
  values.parent[0].status = 2;
  assert.throws(() => normalizeDataset(extended, values), /Invalid choice/);
  values.parent[0].status = 1;
  assert.equal(normalizeDataset(extended, values).parent[0].status, 1);
  const external = parseModel({
    ...model,
    entities: model.entities.map((entity) => ({
      ...entity,
      columns: [
        ...entity.columns,
        {
          name: "owner",
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
  assert.throws(() => normalizeDataset(external, data), /external references/);
});

test("documented seed example produces its declared choice and multiline values", async () => {
  const example = JSON.parse(
    readFileSync(
      new URL("../../../docs/examples/seed.json", import.meta.url),
      "utf8",
    ),
  );
  const output = await buildSeed(example);
  assert.equal(output.data.example[0].status, 1);
  assert.equal(output.data.example[0].notes, "First line\nSecond line");
});
