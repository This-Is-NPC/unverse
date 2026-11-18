import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactCatalog,
  artifactFields,
  artifactTypeNames,
  findArtifactType,
} from "../dist/index.js";

test("the catalog lists every built-in type with its fields", () => {
  assert.deepEqual(artifactTypeNames, [
    "table",
    "canvas-app",
    "model-driven-app",
    "cloud-flow",
    "security-role",
    "connection-reference",
    "environment-variable",
    "solution",
    "connector",
  ]);
  for (const entry of artifactCatalog) {
    assert.ok(entry.platformName.length > 0, entry.type);
    assert.deepEqual(entry.sources, ["dataverse"]);
    const declared = [
      ...entry.fields,
      ...entry.absent.map(({ field }) => field),
    ].sort();
    assert.deepEqual(declared, [...artifactFields].sort(), entry.type);
    for (const { reason } of entry.absent) assert.ok(reason.length > 0);
  }
  assert.ok(findArtifactType("canvas-app")?.fields.includes("kind"));
  assert.equal(findArtifactType("nonsense"), undefined);
});
