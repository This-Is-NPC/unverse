import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDependencies,
  dependencyHtml,
  dependencyMermaid,
  dependencySvg,
} from "@unverse/core";
import {
  connectionReferences,
  connectors,
  dependencyGraph,
} from "../dist/index.js";
import {
  dependencyFixture,
  dependencyEnvironment as environment,
  dependencyId as id,
  referenceId,
  referenceRow,
  referenceType,
} from "./fixtures/dependencies.mjs";

const options = { referenceId, direction: "dependent", depth: 6 };
const component = (type, n) => `component:${type}:${id(n)}`;

test("dependency graph keeps consumer-to-requirement direction and transitive impact paths", async () => {
  const { client } = dependencyFixture();
  const graph = await dependencyGraph(client, options, environment);
  assert.equal(graph.closureComplete, true);
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.from === component(29, 102) &&
        edge.to === component(referenceType, 101),
    ),
  );
  const analysis = analyzeDependencies(graph);
  assert.deepEqual(
    analysis.affected.find((row) => row.nodeId === component(300, 103))?.path,
    [component(referenceType, 101), component(29, 102), component(300, 103)],
  );
  assert.ok(
    analysis.cycles.some(
      (group) =>
        group.includes(component(29, 102)) &&
        group.includes(component(29, 104)),
    ),
  );
});
test("typed component identity prevents same-GUID nodes from merging", async () => {
  const graph = await dependencyGraph(
    dependencyFixture().client,
    options,
    environment,
  );
  assert.ok(graph.nodes.some((node) => node.id === component(29, 102)));
  assert.ok(graph.nodes.some((node) => node.id === component(777, 102)));
  assert.equal(
    graph.nodes.find((node) => node.id === component(777, 102)).labelStatus,
    "unresolved",
  );
});
test("dependency functions receive object IDs and the environment-resolved reference type", async () => {
  const fixture = dependencyFixture();
  await dependencyGraph(fixture.client, options, environment);
  assert.ok(
    fixture.requests.some((url) =>
      decodeURIComponent(url.pathname).includes(
        `ObjectId=${referenceId},ComponentType=10089`,
      ),
    ),
  );
  assert.ok(
    fixture.requests.some(
      (url) => url.searchParams.get("$select") === "LogicalName,ObjectTypeCode",
    ),
  );
});
test("denied dependency reads remain incomplete instead of proving no consumers", async () => {
  const graph = await dependencyGraph(
    dependencyFixture({ denied: "RetrieveDependentComponents" }).client,
    options,
    environment,
  );
  assert.equal(graph.complete, false);
  assert.equal(graph.closureComplete, false);
  assert.ok(graph.issues.some((issue) => issue.code === "permission"));
});
test("depth frontier and query budget cannot claim complete dependency closure", async () => {
  const graph = await dependencyGraph(
    dependencyFixture().client,
    { ...options, depth: 1 },
    environment,
  );
  assert.equal(graph.complete, true);
  assert.equal(graph.closureComplete, false);
  assert.ok(graph.frontier.length);
  const capped = await dependencyGraph(
    dependencyFixture().client,
    { ...options, maxQueries: 1 },
    environment,
  );
  assert.equal(capped.complete, false);
  assert.equal(capped.queries, 1);
  assert.ok(capped.issues.some((issue) => issue.code === "query-limit"));
});
test("node and edge bounds keep graph endpoints valid and coverage incomplete", async () => {
  const nodes = await dependencyGraph(
    dependencyFixture().client,
    { ...options, maxNodes: 2 },
    environment,
  );
  assert.ok(nodes.nodes.length <= 2);
  assert.equal(nodes.complete, false);
  assert.ok(
    nodes.edges.every(
      (edge) =>
        nodes.nodes.some((node) => node.id === edge.from) &&
        nodes.nodes.some((node) => node.id === edge.to),
    ),
  );
  const edges = await dependencyGraph(
    dependencyFixture().client,
    { ...options, maxEdges: 1 },
    environment,
  );
  assert.ok(edges.edges.length <= 1);
  assert.equal(edges.complete, false);
});
test("solution membership is not a fabricated platform dependency", async () => {
  const graph = await dependencyGraph(
    dependencyFixture({ rows: [] }).client,
    { solutionId: id(200), direction: "dependent", depth: 2 },
    environment,
  );
  assert.ok(graph.edges.some((edge) => edge.kind === "contains"));
  assert.ok(
    graph.edges.every((edge) => edge.evidence !== "dataverse-dependency"),
  );
  assert.deepEqual(analyzeDependencies(graph).affected, []);
  assert.deepEqual(
    analyzeDependencies({ ...graph, roots: [component(referenceType, 101)] })
      .affected,
    [],
  );
});
test("unrelated dependency payloads cannot contaminate the observed graph", async () => {
  const graph = await dependencyGraph(
    dependencyFixture({ unrelated: true }).client,
    options,
    environment,
  );
  assert.equal(graph.complete, false);
  assert.ok(!graph.nodes.some((node) => node.objectId === id(900)));
});
test("duplicate dependency evidence is deduplicated and cycles terminate", async () => {
  const graph = await dependencyGraph(
    dependencyFixture({ duplicate: true }).client,
    options,
    environment,
  );
  assert.equal(graph.closureComplete, true);
  assert.equal(
    graph.edges.filter((edge) => edge.kind === "requires").length,
    5,
  );
  assert.ok(graph.queries < 30);
});
test("connection metadata excludes credentials and separates bindings from dependencies", async () => {
  const fixture = dependencyFixture();
  const references = await connectionReferences(fixture.client);
  assert.equal(references[0].health, "not-checked");
  assert.equal(references[0].linked, true);
  assert.equal(
    (await connectors(fixture.client))[0].name,
    "Example custom connector",
  );
  const graph = await dependencyGraph(fixture.client, options, environment);
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.kind === "binds-to" &&
        edge.evidence === "connection-reference-metadata",
    ),
  );
  assert.ok(
    fixture.requests.every(
      (url) =>
        !/connectionparameters|openapidefinition|clientdata/i.test(
          url.searchParams.get("$select") ?? "",
        ),
    ),
  );
});
test("graph visual exports escape hostile metadata and retain incomplete warnings", async () => {
  const graph = await dependencyGraph(
    dependencyFixture().client,
    { ...options, depth: 1 },
    environment,
  );
  const hostile = {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      label: '"] <script>bad()</script> %%{init:evil}%%',
    })),
  };
  const html = dependencyHtml(hostile);
  const mermaid = dependencyMermaid(hostile);
  assert.ok(!html.includes("<script>bad()</script>"));
  assert.ok(html.includes("\\u003cscript>bad()\\u003c/script>"));
  assert.ok(!mermaid.includes("<script>"));
  assert.ok(!mermaid.includes("%%{init:"));
  assert.ok(html.includes('"closureComplete":false'));
  assert.ok(mermaid.includes("closure complete: false"));
  const svg = dependencySvg(hostile);
  assert.match(svg, /^<svg [^>]*class="pele pele-flowchart"/);
  assert.ok(!svg.includes("<script"));
  assert.ok(svg.includes("bad()"));
  assert.ok(svg.includes("Observed dependency graph · incomplete"));
  assert.ok(svg.includes("@media(prefers-color-scheme:dark)"));
});
test("SVG export renders graphs beyond Pele default limits", async () => {
  const graph = await dependencyGraph(
    dependencyFixture().client,
    { ...options, depth: 1 },
    environment,
  );
  const [edge] = graph.edges;
  let svg = "";
  assert.doesNotThrow(() => {
    svg = dependencySvg({ ...graph, edges: Array(8000).fill(edge) });
  });
  assert.equal(svg.match(/class="pele-edge"/g).length, 8000);
});
test("ambiguous roots and invalid budgets fail before dependency calls", async () => {
  const fixture = dependencyFixture();
  await assert.rejects(
    dependencyGraph(
      fixture.client,
      { ...options, objectId: id(1), componentType: 29 },
      environment,
    ),
    /Choose one root/,
  );
  await assert.rejects(
    dependencyGraph(fixture.client, { ...options, maxQueries: 0 }, environment),
    /max-queries/,
  );
  assert.equal(fixture.requests.length, 0);
});
test("unknown root objects are not reported as verified empty dependency sets", async () => {
  const graph = await dependencyGraph(
    dependencyFixture({ rows: [] }).client,
    { objectId: id(900), componentType: 777, bindings: false },
    environment,
  );
  assert.equal(graph.complete, false);
  assert.ok(graph.issues.some((issue) => issue.code === "unverified-object"));
});

test("opaque connection identity is qualified by its connector binding", async () => {
  const fixture = dependencyFixture({
    references: [
      referenceRow,
      {
        ...referenceRow,
        connectionreferenceid: id(107),
        connectorid: "/providers/Microsoft.PowerApps/apis/shared_other",
        _customconnectorid_value: null,
      },
    ],
    memberships: [
      { componenttype: referenceType, objectid: referenceId },
      { componenttype: referenceType, objectid: id(107) },
    ],
  });
  const graph = await dependencyGraph(
    fixture.client,
    { solutionId: id(200), direction: "dependent", depth: 6 },
    environment,
  );
  assert.equal(
    graph.nodes.filter(
      (node) =>
        node.kind === "connection" && node.objectId === "synthetic-connection",
    ).length,
    2,
  );
});

test("authentication failures stop dependency collection rather than yielding a partial success", async () => {
  await assert.rejects(
    dependencyGraph(
      dependencyFixture({ auth: "RetrieveDependentComponents" }).client,
      options,
      environment,
    ),
    (error) => error.code === "authentication",
  );
});

test("unrelated label metadata cannot invent a connection binding", async () => {
  const fixture = dependencyFixture();
  const get = fixture.client.transport.get;
  fixture.client.transport.get = async (input) => {
    const result = await get(input);
    if (new URL(input).pathname.endsWith("/connectionreferences")) {
      const body = JSON.parse(result.body);
      body.value[0].connectionreferenceid = id(900);
      return { ...result, body: JSON.stringify(body) };
    }
    return result;
  };
  const graph = await dependencyGraph(fixture.client, options, environment);
  assert.equal(graph.complete, false);
  assert.ok(graph.issues.some((issue) => issue.code === "unrelated-metadata"));
  assert.ok(!graph.edges.some((edge) => edge.kind === "binds-to"));
});
