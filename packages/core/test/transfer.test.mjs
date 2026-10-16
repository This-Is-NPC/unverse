import assert from "node:assert/strict";
import test from "node:test";
import {
  createManifest,
  normalizeDataset,
  parseManifest,
  parseModel,
  preservedIdentities,
  verifyTransfer,
} from "../dist/index.js";
import data from "./fixtures/data.json" with { type: "json" };
import sourceModel from "./fixtures/schema.json" with { type: "json" };

const model = parseModel(sourceModel);
const source = {
  name: "dev",
  url: "https://synthetic.crm.dynamics.com",
  organizationId: "fixture",
};
const manifest = await createManifest(model, data, source, {
  prefix: "uv",
  solution: "Fixture",
});

test("transfer manifest verifies all declared fixture invariants", async () => {
  assert.equal(
    (await parseManifest(manifest)).fingerprint,
    manifest.fingerprint,
  );
  assert.equal(
    verifyTransfer(manifest, data, preservedIdentities(manifest)).verified,
    true,
  );
});

test("detects a corrupted identity mapping", () => {
  const identities = structuredClone(preservedIdentities(manifest));
  identities.parent[data.parent[0].id] = data.child[0].id;
  const result = verifyTransfer(manifest, data, identities);
  assert.equal(result.verified, false);
  assert.ok(
    result.differences.some((entry) => entry.kind === "identity-mapping"),
  );
});

test("detects extra identity ledger entries and extra rows", () => {
  const identities = structuredClone(preservedIdentities(manifest));
  identities.parent["00000000-0000-0000-0000-000000000103"] =
    "00000000-0000-0000-0000-000000000103";
  assert.equal(verifyTransfer(manifest, data, identities).verified, false);
  const changed = structuredClone(data);
  changed.parent.push({
    ...changed.parent[0],
    id: "00000000-0000-0000-0000-000000000103",
  });
  assert.equal(
    verifyTransfer(manifest, changed, preservedIdentities(manifest)).verified,
    false,
  );
});

test("detects a dropped relationship", () => {
  const changed = structuredClone(data);
  changed.child[0].parentid = null;
  const result = verifyTransfer(
    manifest,
    changed,
    preservedIdentities(manifest),
  );
  assert.equal(result.verified, false);
  assert.ok(result.differences.some((entry) => entry.kind === "relationship"));
});

test("detects changed decimal precision", () => {
  const changed = structuredClone(data);
  changed.parent[0].amount = "12345.60";
  const result = verifyTransfer(
    manifest,
    changed,
    preservedIdentities(manifest),
  );
  assert.equal(result.verified, false);
  assert.ok(result.differences.some((entry) => entry.kind === "decimal"));
});

test("detects changed temporal semantics", () => {
  const changed = structuredClone(data);
  changed.parent[0].instant = "2026-10-17T12:34:56.000+01:00";
  const result = verifyTransfer(
    manifest,
    changed,
    preservedIdentities(manifest),
  );
  assert.equal(result.verified, false);
  assert.ok(result.differences.some((entry) => entry.kind === "temporal"));
});

test("rejects a modified manifest before import", async () => {
  const changed = structuredClone(manifest);
  changed.data.parent[0].amount = "1.00";
  await assert.rejects(parseManifest(changed), /modified/);
});

test("rejects missing columns, broken references, and lossy decimals", () => {
  const missing = structuredClone(data);
  delete missing.child[0].parentid;
  assert.throws(() => normalizeDataset(model, missing), /Missing/);
  const broken = structuredClone(data);
  broken.child[0].parentid = data.child[0].id;
  assert.throws(() => normalizeDataset(model, broken), /Broken relationship/);
  const lossy = structuredClone(data);
  lossy.parent[0].amount = "123.456";
  assert.throws(() => normalizeDataset(model, lossy), /lossy/);
});

test("rejects invalid calendar dates and sub-second instants", () => {
  const invalid = structuredClone(data);
  invalid.parent[0].instant = "2026-02-31T12:34:56.000Z";
  assert.throws(() => normalizeDataset(model, invalid), /Invalid date/);
  const precise = structuredClone(data);
  precise.parent[0].instant = "2026-10-17T12:34:56.789123Z";
  assert.throws(() => normalizeDataset(model, precise), /Sub-second/);
});
