import assert from "node:assert/strict";
import test from "node:test";
import { createManifest, transferDesired } from "@unverse/core";
import data from "../../core/test/fixtures/data.json" with { type: "json" };
import sourceModel from "../../core/test/fixtures/schema.json" with {
  type: "json",
};
import { applyDataPlan, planDesired } from "../dist/index.js";
import { dataFixture } from "./fixtures/data.mjs";

const user = "11111111-2222-3333-4444-555555555555";
const tenantModel = {
  ...sourceModel,
  entities: sourceModel.entities.map((entity) =>
    entity.name === "parent"
      ? {
          ...entity,
          columns: [
            ...entity.columns,
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
          ],
        }
      : entity,
  ),
};

async function prepare() {
  const fixture = await dataFixture(tenantModel);
  const manifest = await createManifest(
    fixture.model,
    {
      ...data,
      parent: data.parent.map((row) => ({ ...row, owner: user })),
    },
    {
      name: "source",
      url: "https://source.crm.dynamics.com",
      organizationId: "source-org",
    },
    fixture.mapping,
  );
  const policy = {
    policyVersion: 1,
    fields: Object.fromEntries(
      fixture.model.entities.flatMap((entity) =>
        entity.columns
          .filter(
            (column) =>
              column.name !== entity.primaryKey &&
              column.references === undefined,
          )
          .map((column) => [
            `${entity.name}.${column.name}`,
            { action: "copy" },
          ]),
      ),
    ),
  };
  const plan = await planDesired(
    fixture.client,
    await transferDesired(manifest, policy, fixture.mapping),
    fixture.environment,
  );
  return { ...fixture, plan };
}

test("Dataverse transfer plans report tenant references as unverified and copies them", async () => {
  const fixture = await prepare();
  assert.ok(
    fixture.plan.limitations.some((line) =>
      /Tenant-scoped references \(parent\.owner\).*not verified/.test(line),
    ),
  );
  assert.ok(
    fixture.plan.limitations.some((line) => /System lookups/.test(line)),
  );
  const report = await applyDataPlan(
    fixture.client,
    fixture.plan,
    fixture.environment,
    true,
  );
  assert.equal(report.verified, true);
  assert.match(
    fixture.batches[0],
    /aadusers\(11111111-2222-3333-4444-555555555555\)/,
  );
  assert.deepEqual(
    fixture.rows.get("uv_parents").map((row) => row._uv_owner_value),
    [user],
  );
});
