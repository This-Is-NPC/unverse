#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseModel, planSchema } from "../packages/core/dist/index.js";
import sourceData from "../packages/core/test/fixtures/data.json" with {
  type: "json",
};
import {
  applyDataPlan,
  applySchema,
  inspectSchema,
  planSeed,
  query,
  tables,
} from "../packages/dataverse/dist/index.js";
import { connectDev, reportLiveError } from "./lib/dev.mjs";
import { withSchemaFixture } from "./lib/schema-fixture.mjs";

try {
  const { client, url } = connectDev();
  await withSchemaFixture(
    client,
    url,
    async ({ model, mapping, environment }) => {
      const portable = parseModel({
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
                    nullable: true,
                    maxLength: 8000,
                  },
                  {
                    name: "status",
                    type: "choice",
                    nullable: false,
                    options: [
                      { value: 1, label: "Open" },
                      { value: 2, label: "Closed" },
                    ],
                  },
                ],
              }
            : entity,
        ),
      });
      const plan = await planSchema(
        portable,
        mapping,
        environment,
        await inspectSchema(client, mapping, portable),
      );
      const schema = await applySchema(client, plan, environment, true);
      assert.deepEqual(schema.operations, []);
      assert.deepEqual(schema.blocked, []);
      console.log(
        "Observed DEV: multiline and local choices inspected as equivalent after additive provisioning.",
      );
      const definitions = await tables(client);
      const table = definitions.find(
        (candidate) => candidate.logicalName === `${mapping.prefix}_parent`,
      );
      assert.ok(table?.entitySet);
      const id = randomUUID();
      await assert.rejects(
        client.atomicBatch([
          {
            path: `${table.entitySet}(${id})`,
            createOnly: true,
            body: {
              [`${mapping.prefix}_name`]: "Owned rollback probe",
              [`${mapping.prefix}_status`]: 1,
            },
          },
          {
            path: `${table.entitySet}(${randomUUID()})`,
            createOnly: true,
            body: { [`${mapping.prefix}_invalidcolumn`]: true },
          },
        ]),
        (error) => error.code === "service",
      );
      const rollback = await query(client, {
        table: table.logicalName,
        select: [table.primaryKey],
        filter: `${table.primaryKey} eq ${id}`,
      });
      assert.equal(rollback.rows.length, 0);
      console.log(
        "Observed DEV: a deliberately failed changeset rolled back its earlier row creation.",
      );
      const rows = Object.fromEntries(
        portable.entities.map((entity) => [
          entity.name,
          sourceData[entity.name].map((row) => ({
            key: "first",
            values: Object.fromEntries(
              entity.columns
                .filter((column) => column.name !== entity.primaryKey)
                .map((column) => [
                  column.name,
                  column.references !== undefined
                    ? { key: "first" }
                    : column.name === "notes"
                      ? "Community\nFixture"
                      : column.name === "status"
                        ? 1
                        : row[column.name],
                ]),
            ),
          })),
        ]),
      );
      const seed = {
        seedVersion: 1,
        seed: mapping.prefix,
        model: portable,
        mapping,
        rows,
      };
      const dataPlan = await planSeed(client, seed, environment);
      assert.equal(dataPlan.create.length, 2);
      const report = await applyDataPlan(client, dataPlan, environment, true);
      assert.equal(report.verified, true);
      const repeated = await applyDataPlan(client, dataPlan, environment, true);
      assert.equal(repeated.checkpoint.state, "verified-resume");
      console.log(
        "Observed DEV: deterministic seed preserved IDs, links, choices, multiline, numeric and temporal values; resume was a verified no-op.",
      );
      const extended = parseModel({
        ...portable,
        entities: portable.entities.map((entity) =>
          entity.name === "child"
            ? {
                ...entity,
                columns: [
                  ...entity.columns,
                  {
                    name: "user",
                    type: "uuid",
                    nullable: true,
                    externalReference: {
                      table: "systemuser",
                      primaryKey: "systemuserid",
                    },
                  },
                ],
              }
            : entity,
        ),
      });
      const external = await planSchema(
        extended,
        mapping,
        environment,
        await inspectSchema(client, mapping, extended),
      );
      const applied = await applySchema(client, external, environment, true);
      assert.deepEqual(applied.blocked, []);
      assert.deepEqual(applied.operations, []);
      console.log(
        "Observed DEV: an owned lookup to an existing system table was added and verified without modifying existing records.",
      );
    },
  );
} catch (error) {
  reportLiveError(error, true);
}
