#!/usr/bin/env node
import assert from "node:assert/strict";
import { parseModel, planSchema } from "../packages/core/dist/index.js";
import {
  applySchema,
  inspectSchema,
} from "../packages/dataverse/dist/index.js";
import { connectDev, reportLiveError } from "./lib/dev.mjs";
import { withSchemaFixture } from "./lib/schema-fixture.mjs";

try {
  const { client, url } = connectDev();
  await withSchemaFixture(
    client,
    url,
    async ({ model, mapping, environment }) => {
      const additive = parseModel({
        ...model,
        entities: model.entities.map((entity) =>
          entity.name === "parent"
            ? {
                ...entity,
                columns: [
                  ...entity.columns,
                  {
                    name: "extra",
                    type: "text",
                    nullable: true,
                    maxLength: 80,
                  },
                ],
              }
            : entity,
        ),
      });
      const before = await inspectSchema(client, mapping);
      const plan = await planSchema(additive, mapping, environment, before);
      assert.equal(plan.operations.length, 1);
      const remaining = await applySchema(client, plan, environment, true);
      assert.deepEqual(remaining.operations, []);
      assert.deepEqual(remaining.blocked, []);
      const repeated = await applySchema(client, remaining, environment, true);
      assert.deepEqual(repeated.operations, []);
      console.log(
        "Observed DEV: added one field; a repeated satisfied plan created no duplicate structure.",
      );
    },
  );
} catch (error) {
  reportLiveError(error, true);
}
