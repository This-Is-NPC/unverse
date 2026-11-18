import assert from "node:assert/strict";
import test from "node:test";
import { parseArtifactDeclarations } from "@unverse/core";
import {
  checkDeclaredArtifacts,
  listDeclaredArtifacts,
} from "../dist/index.js";
import { artifactFixture, id } from "./fixtures/artifacts.mjs";

const declarations = parseArtifactDeclarations({
  artifactsVersion: 1,
  types: {
    "code-app": { from: "canvas-app", where: { kind: "code-app" } },
    "uv-table": { from: "table", where: { name: ["account", "uv_*"] } },
    "any-app": { from: "canvas-app" },
    role: { from: "security-role" },
    "solved-app": { from: "canvas-app", where: { publisher: "uv" } },
  },
  rules: {
    "any-app": { solution: "required", publisher: ["uv"] },
    "uv-table": { solution: ["uv_other"] },
    role: { solution: "forbidden" },
  },
});

const paths = (requests) =>
  requests.map((url) => new URL(url).pathname.split("/").at(-1));

test("one membership read serves every item and every type", async () => {
  const { client, requests } = artifactFixture();
  const outcome = await checkDeclaredArtifacts(client, declarations);
  const read = paths(requests);
  assert.equal(read.filter((path) => path === "solutions").length, 1);
  assert.equal(read.filter((path) => path === "solutioncomponents").length, 1);
  assert.equal(read.filter((path) => path === "canvasapps").length, 1);
  const components = requests.find((url) =>
    url.includes("/solutioncomponents"),
  );
  assert.equal(
    new URL(components).searchParams.get("$filter"),
    "componenttype eq 1 or componenttype eq 300 or componenttype eq 20",
  );
  assert.deepEqual(
    outcome.violations.map((entry) => [
      entry.type,
      entry.rule,
      entry.item.id,
      entry.observed,
    ]),
    [
      ["uv-table", "solution", "account", ["uv_solution"]],
      ["any-app", "solution", id(3), []],
      ["any-app", "publisher", id(3), []],
      ["any-app", "solution", id(2), []],
      ["any-app", "publisher", id(2), []],
      ["role", "solution", id(7), ["uv_other"]],
    ],
  );
  assert.equal(outcome.checked, 7);
  assert.deepEqual(outcome.unknown, []);
});

test("membership is attached only when a type needs it", async () => {
  const { client, requests } = artifactFixture();
  const plain = parseArtifactDeclarations({
    artifactsVersion: 1,
    types: { app: { from: "canvas-app" } },
    rules: { app: { name: "uv_*" } },
  });
  const outcome = await checkDeclaredArtifacts(client, plain);
  assert.deepEqual(outcome.unknown, []);
  assert.deepEqual(
    paths(requests).filter((path) => path !== "WhoAmI"),
    ["canvasapps"],
  );
});

test("a declared type lists its filtered items with their solutions", async () => {
  const { client } = artifactFixture();
  const listed = await listDeclaredArtifacts(
    client,
    declarations,
    "solved-app",
  );
  assert.equal(listed.complete, true);
  assert.deepEqual(
    listed.items.map((entry) => [
      entry.id,
      entry.solutions.map((s) => s.uniqueName),
    ]),
    [[id(1), ["uv_solution"]]],
  );
  const capped = await listDeclaredArtifacts(
    client,
    declarations,
    "any-app",
    2,
  );
  assert.equal(capped.complete, false);
  assert.equal(capped.items.length, 2);
  await assert.rejects(
    listDeclaredArtifacts(client, declarations, "any-app", 0),
    (error) => error.code === "invalid-input",
  );
});

test("system solutions are not membership", async () => {
  const { client } = artifactFixture();
  const listed = await listDeclaredArtifacts(client, declarations, "any-app");
  const bare = listed.items.find((entry) => entry.id === id(3));
  assert.deepEqual(bare.solutions, []);
  const first = listed.items.find((entry) => entry.id === id(1));
  assert.deepEqual(
    first.solutions.map((entry) => entry.uniqueName),
    ["uv_solution"],
  );
});
