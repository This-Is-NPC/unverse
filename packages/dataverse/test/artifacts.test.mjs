import assert from "node:assert/strict";
import test from "node:test";
import { artifactCatalog, findArtifactType } from "@unverse/core";
import { listArtifacts } from "../dist/index.js";
import { artifactFixture, id } from "./fixtures/artifacts.mjs";

async function items(type, overrides) {
  const { client } = artifactFixture(overrides);
  return (await listArtifacts(client, findArtifactType(type))).items;
}

test("every built-in type normalizes to the declared fields", async () => {
  for (const entry of artifactCatalog) {
    const result = await items(entry.type);
    assert.ok(result.length > 0, entry.type);
    for (const row of result) {
      assert.equal(row.type, entry.type);
      assert.equal(row.source, "dataverse");
      for (const { field } of entry.absent)
        assert.ok(!(field in row), `${entry.type} invented ${field}`);
    }
  }
});

test("a field the source does not provide stays absent", async () => {
  const apps = await items("canvas-app");
  assert.deepEqual(
    apps.find((row) => row.id === id(3)),
    {
      type: "canvas-app",
      id: id(3),
      name: "uv_bare",
      displayName: "Bare app",
      kind: "unknown",
      source: "dataverse",
    },
  );
  const bare = (type, row) =>
    items(type).then((all) => all.find((entry) => entry.id === id(row)));
  assert.ok(!("managed" in (await bare("security-role", 8))));
  assert.ok(!("managed" in (await bare("environment-variable", 11))));
  const flow = (await items("cloud-flow")).find((row) => row.id === id(6));
  assert.deepEqual(Object.keys(flow).sort(), [
    "displayName",
    "id",
    "name",
    "source",
    "type",
  ]);
  assert.ok(!("displayName" in (await items("table"))[1]));
});

test("canvas apps are distinguished by their app type", async () => {
  const apps = await items("canvas-app");
  const kinds = Object.fromEntries(apps.map((row) => [row.id, row.kind]));
  assert.deepEqual(kinds, {
    [id(1)]: "classic",
    [id(2)]: "code-app",
    [id(3)]: "unknown",
  });
  const code = apps.find((row) => row.id === id(2));
  assert.equal(code.managed, true);
  assert.equal(code.owner, id(91));
});

test("each type reads its platform name once without a request per item", async () => {
  for (const entry of artifactCatalog) {
    const { client, requests } = artifactFixture();
    await listArtifacts(client, entry);
    const paths = requests.map((url) =>
      new URL(url).pathname.split("/").at(-1),
    );
    assert.ok(paths.includes(entry.platformName), entry.type);
    assert.equal(
      paths.filter((path) => path !== "WhoAmI").length,
      1,
      entry.type,
    );
  }
});

test("a cap shorter than the list is reported as incomplete", async () => {
  const { client } = artifactFixture();
  const spec = findArtifactType("canvas-app");
  const capped = await listArtifacts(client, spec, 2);
  assert.equal(capped.complete, false);
  assert.equal(capped.items.length, 2);
  const exact = await listArtifacts(client, spec, 3);
  assert.equal(exact.complete, true);
  assert.equal(exact.items.length, 3);
  await assert.rejects(
    listArtifacts(client, spec, 0),
    (error) => error.code === "invalid-input",
  );
});
