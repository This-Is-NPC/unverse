import assert from "node:assert/strict";
import test from "node:test";
import {
  createManifest,
  seedDesired,
  seedId,
  transferDesired,
} from "@unverse/core";
import data from "../../core/test/fixtures/data.json" with { type: "json" };
import baseModel from "../../core/test/fixtures/schema.json" with {
  type: "json",
};
import { seedSpec } from "../../core/test/fixtures/seed.mjs";
import { applyDataPlan, planDesired } from "../dist/index.js";
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
  const plan = await planDesired(
    fixture.client,
    await transferDesired(manifest, policy, fixture.mapping),
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
    planDesired(
      fixture.client,
      await transferDesired(fixture.manifest, fixture.policy, fixture.mapping),
      { ...fixture.environment, organizationId: "source-org" },
    ),
    /distinct/,
  );
});

test("seed plans generate create-only rows in the authenticated target", async () => {
  const fixture = await dataFixture();
  const plan = await planDesired(
    fixture.client,
    await seedDesired(seedSpec(fixture.model, fixture.mapping, data)),
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
  const plan = await planDesired(
    fixture.client,
    await seedDesired(seedSpec(fixture.model, fixture.mapping, cyclicData)),
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
  const plan = await planDesired(
    fixture.client,
    await transferDesired(fixture.manifest, fixture.policy, fixture.mapping),
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
    planDesired(
      fixture.client,
      await transferDesired(manifest, fixture.policy, fixture.mapping),
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

async function appliedSeed() {
  const fixture = await dataFixture();
  const spec = seedSpec(fixture.model, fixture.mapping, data);
  const desired = await seedDesired(spec);
  const plan = await planDesired(fixture.client, desired, fixture.environment);
  await applyDataPlan(fixture.client, plan, fixture.environment, true);
  const replan = async (changed = desired) =>
    planDesired(
      fixture.client,
      { ...changed, onExisting: "update" },
      fixture.environment,
    );
  return { ...fixture, spec, desired, replan };
}

function operations(batch) {
  return [
    ...batch.matchAll(
      /(PATCH|DELETE) [^\r\n]+\r\n(?:Content-Type: [^\r\n]+\r\n)?(If-[A-Za-z-]+): \*\r\n\r\n([^\r\n]*)/g,
    ),
  ].map(([, method, header, body]) => ({ method, header, body }));
}

test("re-running an applied seed with onExisting update reports every row unchanged", async () => {
  const fixture = await appliedSeed();
  const plan = await fixture.replan();
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.update, []);
  assert.deepEqual(plan.blocked, []);
  assert.deepEqual(plan.unchanged, { parent: 1, child: 1 });
  assert.deepEqual(plan.matched, []);
  const report = await applyDataPlan(
    fixture.client,
    plan,
    fixture.environment,
    true,
  );
  assert.equal(report.checkpoint.state, "verified-resume");
  assert.equal(fixture.batches.length, 1);
});

test("an update carries only the differing modeled fields and never creates", async () => {
  const fixture = await appliedSeed();
  fixture.rows.get("uv_parents")[0].uv_name = "Drifted";
  const plan = await fixture.replan();
  assert.deepEqual(plan.update, [
    {
      entity: "parent",
      id: plan.update[0].id,
      fields: { name: "Synthetic Parent" },
    },
  ]);
  assert.deepEqual(plan.unchanged, { parent: 0, child: 1 });
  const report = await applyDataPlan(
    fixture.client,
    plan,
    fixture.environment,
    true,
  );
  assert.equal(report.verified, true);
  assert.deepEqual(operations(fixture.batches[1]), [
    {
      method: "PATCH",
      header: "If-Match",
      body: JSON.stringify({ uv_name: "Synthetic Parent" }),
    },
  ]);
  assert.equal(fixture.rows.get("uv_parents")[0].uv_name, "Synthetic Parent");
});

test("an existing differing row blocks by default and updates only on request", async () => {
  const fixture = await appliedSeed();
  fixture.rows.get("uv_parents")[0].uv_name = "Drifted";
  const blocked = await planDesired(
    fixture.client,
    fixture.desired,
    fixture.environment,
  );
  assert.equal(blocked.onExisting, "block");
  assert.equal(blocked.blocked.length, 1);
  assert.deepEqual(blocked.update, []);
  await assert.rejects(
    planDesired(
      fixture.client,
      { ...fixture.desired, onExisting: "overwrite" },
      fixture.environment,
    ),
    /onExisting/,
  );
});

test("an update plan is rejected when the target changed after planning", async () => {
  const fixture = await appliedSeed();
  fixture.rows.get("uv_parents")[0].uv_name = "Drifted";
  const plan = await fixture.replan();
  fixture.rows.get("uv_parents")[0].uv_count = 99;
  await assert.rejects(
    applyDataPlan(fixture.client, plan, fixture.environment, true),
    /stale/,
  );
  assert.equal(fixture.batches.length, 1);
});

test("a changeset runs creates, then updates, then link updates", async () => {
  const fixture = await appliedSeed();
  const spec = structuredClone(fixture.spec);
  spec.rows.parent.push({
    key: "added",
    values: { ...spec.rows.parent[0].values, name: "Added" },
  });
  spec.rows.parent[0].values.name = "Renamed";
  spec.rows.child[0].values.parentid = { key: "added" };
  const plan = await fixture.replan(await seedDesired(spec));
  assert.equal(plan.create.length, 1);
  assert.equal(plan.update.length, 2);
  await applyDataPlan(fixture.client, plan, fixture.environment, true);
  assert.deepEqual(
    operations(fixture.batches[1]).map(({ header, body }) =>
      header === "If-None-Match"
        ? "create"
        : body.includes("@odata.bind")
          ? "link"
          : "update",
    ),
    ["create", "update", "link"],
  );
});

function keyedModel(parentKeys) {
  const required = (names) => (column) =>
    names.includes(column.name) ? { ...column, nullable: false } : column;
  return {
    ...baseModel,
    entities: baseModel.entities.map((entity) =>
      entity.name === "parent"
        ? {
            ...entity,
            columns: entity.columns.map(required(["count"])),
            keys: parentKeys,
          }
        : {
            ...entity,
            columns: entity.columns.map(required(["parentid"])),
            keys: [{ name: "byparent", columns: ["parentid", "name"] }],
          },
    ),
  };
}

/** A target seeded under namespace "old" and a desired seed under "new". */
async function renamedSeed(parentKeys, change = (copy) => copy) {
  const fixture = await dataFixture(keyedModel(parentKeys));
  const old = await seedDesired(
    seedSpec(fixture.model, fixture.mapping, data, "old"),
  );
  await applyDataPlan(
    fixture.client,
    await planDesired(fixture.client, old, fixture.environment),
    fixture.environment,
    true,
  );
  const desired = await seedDesired(
    seedSpec(
      fixture.model,
      fixture.mapping,
      change(structuredClone(data)),
      "new",
    ),
  );
  const ids = {
    oldParent: await seedId("old", "parent", "row-0"),
    oldChild: await seedId("old", "child", "row-0"),
    newParent: await seedId("new", "parent", "row-0"),
    newChild: await seedId("new", "child", "row-0"),
  };
  const plan = (onExisting) =>
    planDesired(
      fixture.client,
      onExisting === undefined ? desired : { ...desired, onExisting },
      fixture.environment,
    );
  return { ...fixture, ids, plan };
}

test("a row matches an existing target row by alternate key and its children follow", async () => {
  const fixture = await renamedSeed(
    [{ name: "byname", columns: ["name"] }],
    (copy) => {
      copy.parent[0].amount = "1.00";
      return copy;
    },
  );
  const plan = await fixture.plan("update");
  const { ids } = fixture;
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.matched, [
    {
      entity: "parent",
      id: ids.newParent,
      targetId: ids.oldParent,
      key: "byname",
    },
    {
      entity: "child",
      id: ids.newChild,
      targetId: ids.oldChild,
      key: "byparent",
    },
  ]);
  assert.deepEqual(plan.update, [
    { entity: "parent", id: ids.oldParent, fields: { amount: "1.00" } },
  ]);
  assert.deepEqual(plan.unchanged, { parent: 0, child: 1 });
  const report = await applyDataPlan(
    fixture.client,
    plan,
    fixture.environment,
    true,
  );
  assert.equal(report.verified, true);
  assert.equal(fixture.rows.get("uv_parents").length, 1);
  assert.equal(fixture.rows.get("uv_childs").length, 1);
  assert.equal(fixture.rows.get("uv_parents")[0].uv_amount, 1);
  assert.match(fixture.batches[1], new RegExp(ids.oldParent));
  assert.doesNotMatch(fixture.batches[1], new RegExp(ids.newParent));
});

test("a key-matched row that differs blocks unless onExisting is update", async () => {
  const fixture = await renamedSeed(
    [{ name: "byname", columns: ["name"] }],
    (copy) => {
      copy.parent[0].amount = "1.00";
      return copy;
    },
  );
  const plan = await fixture.plan();
  assert.deepEqual(plan.blocked, [
    {
      entity: "parent",
      id: fixture.ids.oldParent,
      reason: "An existing row differs; set onExisting to update to change it.",
    },
  ]);
  assert.deepEqual(plan.create, []);
});

test("a target row claimed by two desired rows blocks the second", async () => {
  const fixture = await renamedSeed(
    [
      { name: "k1name", columns: ["name"] },
      { name: "k2count", columns: ["count"] },
    ],
    (copy) => {
      copy.parent[0].count = 5;
      copy.parent.push({
        ...copy.parent[0],
        id: "00000000-0000-0000-0000-000000000199",
        name: "Second",
        count: 7,
      });
      return copy;
    },
  );
  const plan = await fixture.plan("update");
  assert.equal(
    plan.matched.filter(({ entity }) => entity === "parent").length,
    1,
  );
  assert.equal(plan.blocked.length, 1);
  assert.match(plan.blocked[0].reason, /belongs to another desired row/);
  await assert.rejects(
    applyDataPlan(fixture.client, plan, fixture.environment, true),
    /conflicting/,
  );
  assert.equal(fixture.batches.length, 1);
});

test("alternate keys are tried in declaration order and the first hit wins", async () => {
  const fixture = await renamedSeed(
    [
      { name: "k1name", columns: ["name"] },
      { name: "k2count", columns: ["count"] },
    ],
    (copy) => {
      copy.parent[0].count = 8;
      return copy;
    },
  );
  fixture.rows.get("uv_parents").push({
    ...fixture.rows.get("uv_parents")[0],
    uv_parentid: "00000000-0000-0000-0000-000000000999",
    uv_name: "Other",
    uv_count: 8,
  });
  const plan = await fixture.plan("update");
  assert.equal(plan.matched[0].key, "k1name");
  assert.equal(plan.matched[0].targetId, fixture.ids.oldParent);
});

function renamedModel() {
  return JSON.parse(
    JSON.stringify(baseModel)
      .replaceAll('"parent"', '"alpha"')
      .replaceAll('"child"', '"omega"'),
  );
}

/** Entities named so the parent sorts before its child. */
async function purgeFixture({ apply = true } = {}) {
  const fixture = await dataFixture(renamedModel());
  const desired = await seedDesired(
    seedSpec(
      fixture.model,
      fixture.mapping,
      { alpha: data.parent, omega: data.child },
      "purge",
    ),
  );
  if (apply)
    await applyDataPlan(
      fixture.client,
      await planDesired(fixture.client, desired, fixture.environment),
      fixture.environment,
      true,
    );
  const ids = {
    alpha: await seedId("purge", "alpha", "row-0"),
    omega: await seedId("purge", "omega", "row-0"),
  };
  const plan = () =>
    planDesired(
      fixture.client,
      { ...desired, purge: true },
      fixture.environment,
    );
  return { ...fixture, desired, ids, plan };
}

test("a purge plan is destructive and deletes only the rows the seed derives, children first", async () => {
  const fixture = await purgeFixture();
  fixture.rows.get("uv_alphas").push({
    ...fixture.rows.get("uv_alphas")[0],
    uv_alphaid: "00000000-0000-0000-0000-000000000777",
    uv_name: "Not from the seed",
  });
  const plan = await fixture.plan();
  assert.equal(plan.effect, "destructive");
  assert.deepEqual(plan.delete, [
    { entity: "omega", id: fixture.ids.omega },
    { entity: "alpha", id: fixture.ids.alpha },
  ]);
  assert.deepEqual([plan.create, plan.update, plan.absent], [[], [], []]);
  const report = await applyDataPlan(
    fixture.client,
    plan,
    fixture.environment,
    true,
  );
  assert.equal(report.verified, true);
  assert.deepEqual(
    operations(fixture.batches[1]).map(({ method, header, body }) => [
      method,
      header,
      body,
    ]),
    [
      ["DELETE", "If-Match", ""],
      ["DELETE", "If-Match", ""],
    ],
  );
  assert.match(
    fixture.batches[1],
    new RegExp(
      `uv_omegas\\(${fixture.ids.omega}\\).*uv_alphas\\(${fixture.ids.alpha}\\)`,
      "s",
    ),
  );
  assert.deepEqual(
    fixture.rows.get("uv_alphas").map((row) => row.uv_name),
    ["Not from the seed"],
  );
  assert.equal(fixture.rows.get("uv_omegas").length, 0);
});

test("a purge reports rows that are already absent and writes nothing", async () => {
  const fixture = await purgeFixture({ apply: false });
  const plan = await fixture.plan();
  assert.deepEqual(plan.delete, []);
  assert.deepEqual(plan.absent, [
    { entity: "alpha", id: fixture.ids.alpha },
    { entity: "omega", id: fixture.ids.omega },
  ]);
  const report = await applyDataPlan(
    fixture.client,
    plan,
    fixture.environment,
    true,
  );
  assert.equal(report.verified, true);
  assert.equal(report.checkpoint.state, "verified-resume");
  assert.equal(fixture.batches.length, 0);
});

test("a purge never deletes a row that a row outside the seed references", async () => {
  const fixture = await purgeFixture();
  fixture.rows.get("uv_omegas").push({
    uv_omegaid: "00000000-0000-0000-0000-000000000888",
    uv_name: "Not from the seed",
    _uv_parentid_value: fixture.ids.alpha,
  });
  const plan = await fixture.plan();
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.blocked[0].id, fixture.ids.alpha);
  assert.match(plan.blocked[0].reason, /does not derive/);
  await assert.rejects(
    applyDataPlan(fixture.client, plan, fixture.environment, true),
    /conflicting/,
  );
  assert.equal(fixture.batches.length, 1);
});

test("purge verification fails when a deleted row is still in the target", async () => {
  const fixture = await purgeFixture();
  const plan = await fixture.plan();
  fixture.keepRowsOnDelete();
  const report = await applyDataPlan(
    fixture.client,
    plan,
    fixture.environment,
    true,
  );
  assert.equal(report.verified, false);
  assert.equal(report.remaining.length, 2);
});

test("a purge plan is rejected when the target changed after planning", async () => {
  const fixture = await purgeFixture();
  const plan = await fixture.plan();
  fixture.rows.get("uv_alphas").push({
    ...fixture.rows.get("uv_alphas")[0],
    uv_alphaid: "00000000-0000-0000-0000-000000000777",
    uv_name: "Added after planning",
  });
  await assert.rejects(
    applyDataPlan(fixture.client, plan, fixture.environment, true),
    /stale/,
  );
  assert.equal(fixture.batches.length, 1);
});

test("purge cannot combine with updates or a transfer source", async () => {
  const fixture = await purgeFixture({ apply: false });
  await assert.rejects(
    planDesired(
      fixture.client,
      { ...fixture.desired, purge: true, onExisting: "update" },
      fixture.environment,
    ),
    /purge/,
  );
});
