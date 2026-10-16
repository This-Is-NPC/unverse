#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzeDependencies } from "../packages/core/dist/index.js";
import {
  connectionReferences,
  connectors,
  dependencyGraph,
} from "../packages/dataverse/dist/index.js";
import { connectDev, reportLiveError } from "./lib/dev.mjs";

try {
  const { client, url } = connectDev();
  const identity = await client.whoAmI();
  const environment = {
    name: "dev",
    url,
    organizationId: identity.organizationId,
  };
  const references = await connectionReferences(client);
  const custom = await connectors(client);
  console.log(
    `Observed DEV: ${references.length} references and ${custom.length} solution-aware connectors; no IDs, names, bindings, or credentials logged.`,
  );
  assert.ok(
    references.length,
    "The read-only dependency probe requires a visible reference.",
  );
  let observed = false;
  for (const reference of references.slice(0, 3)) {
    const graph = await dependencyGraph(
      client,
      {
        referenceId: reference.id,
        direction: "dependent",
        depth: 3,
        maxNodes: 40,
        maxEdges: 100,
        maxQueries: 25,
      },
      environment,
    );
    assert.ok(
      graph.nodes.some(
        (node) =>
          node.kind === "connection-reference" &&
          node.objectId === reference.id,
      ),
    );
    assert.ok(
      graph.nodes.length <= 40 &&
        graph.edges.length <= 100 &&
        graph.queries <= 25,
    );
    const analysis = analyzeDependencies(graph);
    console.log(
      `Observed DEV graph: nodes=${graph.nodes.length}, edges=${graph.edges.length}, potential consumers=${analysis.affected.length}, cycles=${analysis.cycles.length}, closureComplete=${graph.closureComplete}; issues=${[...new Set(graph.issues.map((issue) => issue.code))].join(",") || "none"}.`,
    );
    if (graph.edges.some((edge) => edge.evidence === "dataverse-dependency")) {
      observed = true;
      break;
    }
  }
  assert.ok(
    observed,
    "The bounded probe needs a reference with an observed declared consumer; no non-use claim was made.",
  );
  console.log(
    "Observed: official dependency edges and explicit connection bindings remain distinct; only reads were issued.",
  );
} catch (error) {
  reportLiveError(error, true);
}
