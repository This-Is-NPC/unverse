#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  normalizeDataset,
  physicalColumn,
  physicalEntity,
  preservedIdentities,
  verifyTransfer,
} from "../packages/core/dist/index.js";
import sourceData from "../packages/core/test/fixtures/data.json" with {
  type: "json",
};
import {
  exportTransfer,
  query,
  tables,
} from "../packages/dataverse/dist/index.js";
import { PostgresStore } from "../packages/postgres/dist/index.js";
import { connectDev, reportLiveError } from "./lib/dev.mjs";
import { withPostgres } from "./lib/postgres.mjs";
import { withSchemaFixture } from "./lib/schema-fixture.mjs";

try {
  const { client, url } = connectDev();
  await withPostgres(async (connection) =>
    withSchemaFixture(client, url, async ({ model, mapping, environment }) => {
      const data = normalizeDataset(model, sourceData);
      const definitions = await tables(client);
      const sets = Object.fromEntries(
        model.entities.map((entity) => {
          const metadata = definitions.find(
            (candidate) =>
              candidate.logicalName === physicalEntity(mapping, entity),
          );
          assert.ok(
            metadata?.entitySet,
            "Owned fixture entity must expose an entity set.",
          );
          return [entity.name, metadata.entitySet];
        }),
      );
      for (const entity of model.entities)
        for (const row of data[entity.name]) {
          const body = {};
          for (const column of entity.columns) {
            if (column.references !== undefined) continue;
            const value = row[column.name];
            body[physicalColumn(mapping, entity, column)] =
              value === null
                ? null
                : column.type === "decimal"
                  ? Number(value)
                  : value;
          }
          await client.write("POST", sets[entity.name], body);
        }
      for (const entity of model.entities)
        for (const column of entity.columns) {
          if (column.references === undefined) continue;
          const relationName = `${mapping.prefix}_${entity.name}_${column.name}`;
          const relations = await client.collect(
            `RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata?${new URLSearchParams({ $select: "SchemaName,ReferencingEntityNavigationPropertyName", $filter: `SchemaName eq '${relationName}'` })}`,
          );
          assert.equal(relations.rows.length, 1);
          const navigation =
            relations.rows[0].ReferencingEntityNavigationPropertyName;
          assert.match(navigation, /^[a-zA-Z][a-zA-Z0-9_]*$/);
          for (const row of data[entity.name]) {
            const target = row[column.name];
            if (target !== null)
              await client.write(
                "PATCH",
                `${sets[entity.name]}(${row[entity.primaryKey]})`,
                {
                  [`${navigation}@odata.bind`]: `/${sets[column.references]}(${target})`,
                },
              );
          }
        }
      const parent = model.entities.find((entity) => entity.name === "parent");
      const instantColumn = parent.columns.find(
        (column) => column.name === "instant",
      );
      const parentRow = data.parent[0];
      const field = physicalColumn(mapping, parent, instantColumn);
      const probe = "2026-10-17T12:34:56.789Z";
      await client.write("PATCH", `${sets.parent}(${parentRow.id})`, {
        [field]: probe,
      });
      const observed = await query(client, {
        table: physicalEntity(mapping, parent),
        select: [field],
        limit: 1,
      });
      const returned = new Date(observed.rows[0][field]);
      console.log(
        `Observed DEV temporal capability: fractional probe exact=${returned.getTime() === Date.parse(probe)}; returned millisecond component=${returned.getUTCMilliseconds()}.`,
      );
      await client.write("PATCH", `${sets.parent}(${parentRow.id})`, {
        [field]: parentRow.instant,
      });
      const manifest = await exportTransfer(
        client,
        model,
        mapping,
        environment,
      );
      const sourceVerification = verifyTransfer(
        manifest,
        data,
        preservedIdentities(manifest),
      );
      assert.equal(
        sourceVerification.verified,
        true,
        `Source invariants differ: ${sourceVerification.differences.map((item) => `${item.kind}:${item.entity}.${item.column}`).join(", ")}`,
      );
      const store = new PostgresStore(connection, "unverse_fixture");
      try {
        const report = await store.import(manifest, true);
        assert.equal(report.verified, true);
        const resumed = await store.import(manifest, true);
        assert.equal(resumed.checkpoint, "verified-resume");
        const verified = await store.verify(manifest);
        assert.equal(verified.verified, true);
        console.log(
          "Observed DEV → disposable PostgreSQL: row counts, preserved IDs, relationship, decimal, date, UTC instant, and schema definitions verified.",
        );
        console.log(
          "Observed: committed checkpoint resumed as a verified no-op; no real record values were logged.",
        );
      } finally {
        await store.close();
      }
    }),
  );
} catch (error) {
  reportLiveError(error, true);
}
