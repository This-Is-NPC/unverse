#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  apps,
  compareEnvironments,
  flows,
  solutionComponents,
  solutions,
  tables,
  users,
  variables,
} from "../packages/dataverse/dist/index.js";
import { connectDev, reportLiveError } from "./lib/dev.mjs";

try {
  const { client } = connectDev();
  await client.whoAmI();
  for (const [name, read] of [
    ["solutions", solutions],
    ["canvas apps", (client) => apps(client, "canvas")],
    ["model-driven apps", (client) => apps(client, "model-driven")],
    ["cloud flows", flows],
    ["users", users],
    ["masked variables", variables],
    ["tables", tables],
  ]) {
    const result = await read(client);
    console.log(
      `Observed DEV read-only inventory: ${name}, ${result.length} rows; no names, IDs, or values logged.`,
    );
    if (name === "solutions" && result.length) {
      const components = await solutionComponents(client, result[0].id);
      console.log(
        `Observed DEV: selected solution membership read (${components.length} components).`,
      );
      const comparison = await compareEnvironments(
        client,
        client,
        "components",
        result[0].uniqueName,
      );
      assert.deepEqual(comparison.differences, []);
      console.log(
        "Observed DEV: typed component self-comparison is consistent; no real IDs logged.",
      );
    }
  }
  const comparison = await compareEnvironments(client, client, "solutions");
  assert.equal(comparison.equal, true);
  console.log(
    "Observed DEV: solution self-comparison is consistent; distinct-environment comparisons remain synthetic evidence.",
  );
} catch (error) {
  reportLiveError(error, true);
}
