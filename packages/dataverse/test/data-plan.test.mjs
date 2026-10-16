import assert from "node:assert/strict";
import test from "node:test";
import { createManifest } from "@unverse/core";
import data from "../../core/test/fixtures/data.json" with { type: "json" };
import { seedSpec } from "../../core/test/fixtures/seed.mjs";
import {
  applyDataPlan,
  planDataverseTransfer,
  planSeed,
} from "../dist/index.js";
import { dataFixture } from "./fixtures/data.mjs";

async function prepare() {
  const fixture = await dataFixture();
  const manifest = await createManifest(
    fixture.model,
    data,
    {
      name: "source",
      url: "https://source.crm.dynamics.com",
      organizationId: "source-org",
    },
    fixture.mapping,
  );
  const fields = Object.fromEntries(
    fixture.model.entities.flatMap((entity) =>
      entity.columns
        .filter(
          (column) =>
            column.name !== entity.primaryKey &&
            column.references === undefined,
        )
        .map((column) => [`${entity.name}.${column.name}`, { action: "copy" }]),
    ),
  );
  const policy = { policyVersion: 1, fields };
  const plan = await planDataverseTransfer(
    fixture.client,
    manifest,
    policy,
    fixture.mapping,
    fixture.environment,
  );
  return { ...fixture, manifest, policy, plan };
}

test("Dataverse data apply confirms, creates entities then links, and resumes without writes", async () => {
  const fixture = await prepare();
  const report = await applyDataPlan(
    fixture.client,
    fixture.plan,
    fixture.environment,
    true,
  );
  assert.equal(report.verified, true);
  assert.equal(fixture.batches.length, 1);
  assert.ok(
    fixture.batches[0].indexOf("If-None-Match: *") <
      fixture.batches[0].indexOf("If-Match: *"),
  );
  assert.equal(
    (
      await applyDataPlan(
        fixture.client,
        fixture.plan,
        fixture.environment,
        true,
      )
    ).checkpoint.state,
    "verified-resume",
  );
  assert.equal(fixture.batches.length, 1);
});
test("Dataverse data apply rejects missing confirmation before writes", async () => {
  const fixture = await prepare();
  await assert.rejects(
    applyDataPlan(fixture.client, fixture.plan, fixture.environment, false),
    /confirm/,
  );
  assert.equal(fixture.batches.length, 0);
});
test("Dataverse data plans bind the target environment", async () => {
  const fixture = await prepare();
  await assert.rejects(
    applyDataPlan(
      fixture.client,
      fixture.plan,
      { ...fixture.environment, name: "other" },
      true,
    ),
    /another environment/,
  );
  assert.equal(fixture.batches.length, 0);
});
test("Dataverse data plans reject stale target state", async () => {
  const fixture = await prepare();
  fixture.rows.set("uv_parents", [
    {
      uv_parentid: "00000000-0000-0000-0000-000000000103",
      uv_name: "Concurrent",
      uv_amount: null,
      uv_count: null,
      uv_enabled: null,
      uv_day: null,
      uv_instant: null,
    },
  ]);
  await assert.rejects(
    applyDataPlan(fixture.client, fixture.plan, fixture.environment, true),
    /stale/,
  );
  assert.equal(fixture.batches.length, 0);
});
test("Dataverse data plans never overwrite conflicting existing rows", async () => {
  const fixture = await prepare();
  await applyDataPlan(fixture.client, fixture.plan, fixture.environment, true);
  fixture.rows.get("uv_parents")[0].uv_name = "Changed by someone else";
  await assert.rejects(
    applyDataPlan(fixture.client, fixture.plan, fixture.environment, true),
    /conflicting/,
  );
  assert.equal(fixture.batches.length, 1);
});
test("atomic data batch failures cannot produce a verified result", async () => {
  const fixture = await prepare();
  fixture.failBatch();
  await assert.rejects(
    applyDataPlan(fixture.client, fixture.plan, fixture.environment, true),
    /did not confirm/,
  );
  assert.equal(fixture.rows.size, 0);
});
test("Dataverse transfer refuses copying back into the source organization", async () => {
  const fixture = await prepare();
  await assert.rejects(
    planDataverseTransfer(
      fixture.client,
      fixture.manifest,
      fixture.policy,
      fixture.mapping,
      { ...fixture.environment, organizationId: "source-org" },
    ),
    /distinct/,
  );
});

test("seed plans generate create-only rows in the authenticated target", async () => {
  const fixture = await dataFixture();
  const plan = await planSeed(
    fixture.client,
    seedSpec(fixture.model, fixture.mapping, data),
    fixture.environment,
  );
  assert.equal(plan.create.length, 2);
  assert.equal(
    (await applyDataPlan(fixture.client, plan, fixture.environment, true))
      .verified,
    true,
  );
});

test("atomic seed changesets preserve cyclic relationships", async () => {
  const base = await dataFixture();
  const model = {
    ...base.model,
    entities: base.model.entities.map((entity) =>
      entity.name === "parent"
        ? {
            ...entity,
            columns: [
              ...entity.columns,
              {
                name: "childid",
                type: "uuid",
                nullable: true,
                references: "child",
              },
            ],
          }
        : entity,
    ),
  };
  const fixture = await dataFixture(model);
  const cyclicData = structuredClone(data);
  cyclicData.parent[0].childid = data.child[0].id;
  const plan = await planSeed(
    fixture.client,
    seedSpec(fixture.model, fixture.mapping, cyclicData),
    fixture.environment,
  );
  assert.equal(
    (await applyDataPlan(fixture.client, plan, fixture.environment, true))
      .verified,
    true,
  );
  assert.equal(fixture.batches.length, 1);
});

test("transfer plans contain policy-transformed values instead of original fields", async () => {
  const fixture = await prepare();
  fixture.policy.fields["parent.name"] = {
    action: "constant",
    value: "Anonymous",
  };
  const plan = await planDataverseTransfer(
    fixture.client,
    fixture.manifest,
    fixture.policy,
    fixture.mapping,
    fixture.environment,
  );
  assert.equal(plan.manifest.data.parent[0].name, "Anonymous");
  assert.equal(
    (await applyDataPlan(fixture.client, plan, fixture.environment, true))
      .verified,
    true,
  );
  assert.equal(fixture.rows.get("uv_parents")[0].uv_name, "Anonymous");
});

test("data planning rejects datasets beyond the atomic operation bound", async () => {
  const fixture = await prepare();
  const large = {
    child: [],
    parent: Array.from({ length: 1001 }, (_, index) => ({
      ...data.parent[0],
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    })),
  };
  const manifest = await createManifest(
    fixture.model,
    large,
    fixture.manifest.source.environment,
    fixture.mapping,
  );
  await assert.rejects(
    planDataverseTransfer(
      fixture.client,
      manifest,
      fixture.policy,
      fixture.mapping,
      fixture.environment,
    ),
    /1000-operation/,
  );
  assert.equal(fixture.batches.length, 0);
});

test("data plans reject modified desired data before writes", async () => {
  const fixture = await prepare();
  const changed = structuredClone(fixture.plan);
  changed.manifest.data.parent[0].name = "Changed";
  await assert.rejects(
    applyDataPlan(fixture.client, changed, fixture.environment, true),
    /modified/,
  );
  assert.equal(fixture.batches.length, 0);
});
