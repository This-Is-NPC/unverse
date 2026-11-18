import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSeed,
  createManifest,
  lookupLimitations,
  normalizeDataset,
  parseManifest,
  parseModel,
  preservedIdentities,
  verifyTransfer,
} from "../dist/index.js";
import data from "./fixtures/data.json" with { type: "json" };
import sourceModel from "./fixtures/schema.json" with { type: "json" };

const user = "11111111-2222-3333-4444-555555555555";
const source = {
  name: "dev",
  url: "https://synthetic.crm.dynamics.com",
  organizationId: "fixture",
};
const mapping = { prefix: "uv", solution: "Fixture" };

function withReference(externalReference) {
  return {
    ...sourceModel,
    entities: sourceModel.entities.map((entity) => ({
      ...entity,
      columns: [
        ...entity.columns,
        { name: "owner", type: "uuid", nullable: true, externalReference },
      ],
    })),
  };
}

const { id: _id, ...seedValues } = data.parent[0];
const tenant = withReference({
  table: "aaduser",
  primaryKey: "aaduserid",
  scope: "tenant",
});
const rows = Object.fromEntries(
  Object.entries(data).map(([name, list]) => [
    name,
    list.map((row, index) => ({ ...row, owner: index === 0 ? user : null })),
  ]),
);

test("tenant scope is limited to the allowlisted tables", () => {
  const model = parseModel(tenant);
  assert.deepEqual(
    model.entities[0].columns.find((c) => c.name === "owner"),
    {
      name: "owner",
      type: "uuid",
      nullable: true,
      externalReference: {
        table: "aaduser",
        primaryKey: "aaduserid",
        scope: "tenant",
      },
    },
  );
  for (const table of ["systemuser", "team", "businessunit"])
    assert.throws(
      () =>
        parseModel(
          withReference({
            table,
            primaryKey: `${table}id`,
            scope: "tenant",
          }),
        ),
      /tenant-scoped/,
    );
  assert.throws(
    () =>
      parseModel(
        withReference({
          table: "aaduser",
          primaryKey: "systemuserid",
          scope: "tenant",
        }),
      ),
    /tenant-scoped/,
  );
  assert.throws(
    () =>
      parseModel(
        withReference({
          table: "aaduser",
          primaryKey: "aaduserid",
          scope: "global",
        }),
      ),
    /scope/,
  );
});

test("portable datasets keep tenant references as UUIDs without resolving them", async () => {
  const model = parseModel(tenant);
  assert.doesNotThrow(() => normalizeDataset(model, rows));
  const manifest = await createManifest(model, rows, source, mapping);
  assert.equal(manifest.data.parent[0].owner, user);
  assert.equal(
    (await parseManifest(manifest)).fingerprint,
    manifest.fingerprint,
  );
  const seeded = await buildSeed({
    seedVersion: 1,
    seed: "tenant",
    model: tenant,
    mapping,
    rows: {
      parent: [
        {
          key: "first",
          values: { ...seedValues, owner: user },
        },
      ],
      child: [],
    },
  });
  assert.equal(seeded.data.parent[0].owner, user);
});

test("environment-local external references stay rejected", () => {
  const model = parseModel(
    withReference({ table: "systemuser", primaryKey: "systemuserid" }),
  );
  assert.throws(() => normalizeDataset(model, rows), /environment-local/);
});

test("verification reports that tenant references are not verified in the target", async () => {
  const model = parseModel(tenant);
  const manifest = await createManifest(model, rows, source, mapping);
  const report = verifyTransfer(manifest, rows, preservedIdentities(manifest));
  assert.equal(report.verified, true);
  assert.ok(
    report.limitations.some((line) =>
      /Tenant-scoped references.*not verified/.test(line),
    ),
  );
  assert.ok(report.limitations.some((line) => /System lookups/.test(line)));
  const plain = verifyTransfer(
    await createManifest(parseModel(sourceModel), data, source, mapping),
    data,
    preservedIdentities(manifest),
  );
  assert.ok(!plain.limitations.some((line) => /Tenant-scoped/.test(line)));
  assert.equal(lookupLimitations(parseModel(sourceModel)).length, 1);
});
