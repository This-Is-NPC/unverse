import assert from "node:assert/strict";
import test from "node:test";
import { buildSeed, createManifest, parseModel } from "../dist/index.js";
import { seedSpec } from "./fixtures/seed.mjs";

const columns = [
  { name: "id", type: "uuid", nullable: false },
  { name: "name", type: "text", nullable: false, maxLength: 100 },
  { name: "code", type: "text", nullable: false, maxLength: 20 },
  { name: "rank", type: "integer", nullable: false },
  { name: "notes", type: "multiline", nullable: false, maxLength: 500 },
  { name: "enabled", type: "boolean", nullable: false },
  { name: "optional", type: "integer", nullable: true },
];

function modelWith(keys, extra = []) {
  return {
    modelVersion: 1,
    entities: [
      {
        name: "item",
        primaryKey: "id",
        primaryName: "name",
        columns: [...columns, ...extra],
        keys,
      },
    ],
  };
}

test("alternate key declarations reject unsupported, optional, missing, and duplicate columns", () => {
  const valid = parseModel(
    modelWith([
      { name: "by_rank", columns: ["rank", "code"] },
      { name: "by_code", columns: ["code"] },
    ]),
  );
  assert.deepEqual(valid.entities[0].keys, [
    { name: "by_code", columns: ["code"] },
    { name: "by_rank", columns: ["code", "rank"] },
  ]);
  for (const [keys, message] of [
    [[{ name: "k", columns: ["missing"] }], /must exist/],
    [[{ name: "k", columns: ["optional"] }], /required/],
    [[{ name: "k", columns: ["notes"] }], /support text/],
    [[{ name: "k", columns: ["enabled"] }], /support text/],
    [[{ name: "k", columns: ["id"] }], /support text/],
    [[{ name: "k", columns: [] }], /between one and sixteen/],
    [[{ name: "k", columns: ["code", "code"] }], /unique/],
    [
      [
        { name: "k", columns: ["code"] },
        { name: "k", columns: ["rank"] },
      ],
      /unique/,
    ],
    [
      [
        { name: "a", columns: ["code", "rank"] },
        { name: "b", columns: ["rank", "code"] },
      ],
      /same columns/,
    ],
    [[{ name: "k", columns: ["code"], unique: true }], /Unknown/],
    [[], /between one and ten/],
  ])
    assert.throws(() => parseModel(modelWith(keys)), message);
  assert.throws(
    () =>
      parseModel(
        modelWith(
          [{ name: "k", columns: ["parent"] }],
          [{ name: "parent", type: "uuid", nullable: false }],
        ),
      ),
    /support text/,
  );
  assert.ok(
    parseModel(
      modelWith(
        [{ name: "k", columns: ["parent"] }],
        [{ name: "parent", type: "uuid", nullable: false, references: "item" }],
      ),
    ),
  );
});

const source = {
  name: "dev",
  url: "https://synthetic.crm.dynamics.com",
  organizationId: "fixture",
};
const mapping = { prefix: "uv", solution: "Fixture" };
const row = (id, code, rank) => ({
  id,
  name: `Item ${id.at(-1)}`,
  code,
  rank,
  notes: "n",
  enabled: true,
  optional: null,
});

test("seed, export, and transfer reject duplicate alternate key tuples", async () => {
  const model = parseModel(
    modelWith([{ name: "by_pair", columns: ["code", "rank"] }]),
  );
  const ids = [1, 2, 3].map((n) => `00000000-0000-0000-0000-00000000000${n}`);
  const unique = {
    item: [row(ids[0], "a", 1), row(ids[1], "a", 2), row(ids[2], "b", 1)],
  };
  assert.equal(
    (await createManifest(model, unique, source, mapping)).data.item.length,
    3,
  );
  const duplicated = {
    item: [...unique.item, row("00000000-0000-0000-0000-000000000004", "a", 1)],
  };
  await assert.rejects(
    createManifest(model, duplicated, source, mapping),
    /Duplicate alternate key item.by_pair/,
  );
  await assert.rejects(
    buildSeed(seedSpec(model, mapping, duplicated)),
    /Duplicate alternate key/,
  );
  assert.ok(await buildSeed(seedSpec(model, mapping, unique)));
});
