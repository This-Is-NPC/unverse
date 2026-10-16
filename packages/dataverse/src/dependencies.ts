import type {
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
  SchemaEnvironment,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import {
  connectorColumns,
  referenceColumns,
  referenceFromRow,
} from "./connections.js";
import { endpoint, guid, nullableText, text } from "./odata.js";
import { assertEnvironment } from "./schema.js";

export interface DependencyOptions {
  readonly objectId?: string;
  readonly componentType?: number;
  readonly solutionId?: string;
  readonly referenceId?: string;
  readonly direction?: "required" | "dependent" | "both";
  readonly depth?: number;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
  readonly maxQueries?: number;
  readonly bindings?: boolean;
}

export async function dependencyGraph(
  client: DataverseClient,
  options: DependencyOptions,
  environment: SchemaEnvironment,
): Promise<DependencyGraph> {
  const scopeCount =
    Number(options.solutionId !== undefined) +
    Number(options.referenceId !== undefined) +
    Number(
      options.objectId !== undefined || options.componentType !== undefined,
    );
  if (
    scopeCount !== 1 ||
    (options.objectId === undefined) !== (options.componentType === undefined)
  )
    throw new DataverseError(
      "invalid-input",
      "Choose one root: --solution-id, --reference-id, or both --object-id and --component-type.",
    );
  for (const value of [
    options.solutionId,
    options.referenceId,
    options.objectId,
  ])
    if (value !== undefined) guid(value);
  if (options.componentType !== undefined) componentType(options.componentType);
  const direction = options.direction ?? "both";
  if (!["required", "dependent", "both"].includes(direction))
    throw new DataverseError(
      "invalid-input",
      "Dependency direction must be required, dependent, or both.",
    );
  const depth = bounded(options.depth ?? 3, 0, 10, "depth");
  const maxNodes = bounded(options.maxNodes ?? 200, 2, 1000, "max-nodes");
  const maxEdges = bounded(options.maxEdges ?? 1000, 1, 10000, "max-edges");
  const maxQueries = bounded(options.maxQueries ?? 100, 1, 1000, "max-queries");
  await assertEnvironment(client, environment);
  const nodes = new Map<string, DependencyNode>();
  const edges = new Map<string, DependencyEdge>();
  const issues: { nodeId: string | null; operation: string; code: string }[] =
    [];
  const frontier = new Set<string>();
  const roots: string[] = [];
  const observed = new Set<string>();
  const queue: { id: string; depth: number }[] = [];
  const queued = new Set<string>();
  const parents = new Map<string, string>();
  const directions =
    direction === "both" ? (["required", "dependent"] as const) : [direction];
  const bindings = options.bindings !== false;
  let queries = 0;
  const issue = (nodeId: string | null, operation: string, code: string) => {
    if (
      !issues.some(
        (entry) =>
          entry.nodeId === nodeId &&
          entry.operation === operation &&
          entry.code === code,
      )
    )
      issues.push({ nodeId, operation, code });
  };
  async function read(
    path: string,
    nodeId: string | null,
    operation: string,
    limit = 2,
  ) {
    if (queries >= maxQueries) {
      issue(nodeId, operation, "query-limit");
      return undefined;
    }
    queries += 1;
    try {
      const result = await client.collect(path, limit);
      if (!result.complete) issue(nodeId, operation, "row-limit");
      return result;
    } catch (error) {
      if (error instanceof DataverseError && error.code === "authentication")
        throw error;
      issue(
        nodeId,
        operation,
        error instanceof DataverseError ? error.code : "service",
      );
      return undefined;
    }
  }
  function addNode(node: DependencyNode): string | undefined {
    const existing = nodes.get(node.id);
    if (existing) return existing.id;
    if (nodes.size === maxNodes) {
      issue(node.id, "graph", "node-limit");
      return undefined;
    }
    nodes.set(node.id, node);
    return node.id;
  }
  function addComponent(
    type: number,
    objectId: string,
    distance: number,
    parent?: unknown,
  ) {
    const id = `component:${componentType(type)}:${guid(objectId)}`;
    if (typeof parent === "string" && /^[a-f\d-]{36}$/i.test(parent))
      parents.set(id, guid(parent));
    return addNode({
      id,
      objectId: guid(objectId),
      componentType: type,
      kind: "component",
      label: `Component ${type} · ${guid(objectId)}`,
      logicalName: null,
      labelStatus: "unresolved",
      distance,
    });
  }
  function enqueue(id: string | undefined, level: number) {
    if (id !== undefined && !queued.has(id)) {
      queued.add(id);
      queue.push({ id, depth: level });
    }
  }
  function addEdge(edge: DependencyEdge) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
    const key = JSON.stringify(edge);
    if (edges.has(key)) return;
    if (edges.size === maxEdges) {
      issue(edge.from, "graph", "edge-limit");
      return;
    }
    edges.set(key, edge);
  }

  let referenceType: number | undefined;
  if (bindings || options.referenceId !== undefined) {
    const metadata = await read(
      endpoint("EntityDefinitions", {
        $select: "LogicalName,ObjectTypeCode",
        $filter: "LogicalName eq 'connectionreference'",
      }),
      null,
      "reference-type",
    );
    if (
      metadata?.rows.length === 1 &&
      metadata.rows[0]?.LogicalName === "connectionreference"
    ) {
      try {
        referenceType = componentType(metadata.rows[0]?.ObjectTypeCode);
      } catch {
        issue(null, "reference-type", "invalid-metadata");
      }
    } else if (metadata !== undefined)
      issue(null, "reference-type", "unresolved");
  }
  if (options.referenceId !== undefined) {
    if (referenceType === undefined)
      throw new DataverseError(
        issues.some((entry) => entry.code === "permission")
          ? "permission"
          : "unsupported",
        "Connection reference component type could not be resolved; no dependency conclusion was made.",
      );
    const id = addComponent(referenceType, options.referenceId, 0);
    if (id) roots.push(id);
    enqueue(id, 0);
  } else if (options.solutionId !== undefined) {
    const solutionId = guid(options.solutionId);
    const solution = await read(
      endpoint("solutions", {
        $select: "solutionid,uniquename,friendlyname",
        $filter: `solutionid eq ${solutionId}`,
      }),
      null,
      "solution",
    );
    if (solution?.rows.length !== 1)
      throw new DataverseError(
        solution === undefined &&
          issues.some((entry) => entry.code === "permission")
          ? "permission"
          : "invalid-input",
        "The root solution could not be resolved uniquely.",
      );
    const solutionKey = `solution:${solutionId}`;
    addNode({
      id: solutionKey,
      kind: "solution",
      objectId: solutionId,
      componentType: null,
      label: text(solution.rows[0] ?? {}, "friendlyname"),
      logicalName: text(solution.rows[0] ?? {}, "uniquename"),
      labelStatus: "resolved",
      distance: 0,
    });
    roots.push(solutionKey);
    const components = await read(
      endpoint("solutioncomponents", {
        $select: "objectid,componenttype",
        $filter: `_solutionid_value eq ${solutionId}`,
      }),
      solutionKey,
      "solution-membership",
      maxNodes + 1,
    );
    for (const row of components?.rows ?? []) {
      try {
        const id = addComponent(
          componentType(row.componenttype),
          guid(text(row, "objectid")),
          1,
        );
        if (!id) continue;
        observed.add(id);
        if (!roots.includes(id)) roots.push(id);
        enqueue(id, 0);
        addEdge({
          from: solutionKey,
          to: id,
          kind: "contains",
          evidence: "solution-membership",
          dependencyType: null,
        });
      } catch {
        issue(solutionKey, "solution-membership", "unresolved-object");
      }
    }
  } else {
    const id = addComponent(
      options.componentType as number,
      options.objectId as string,
      0,
    );
    if (id) roots.push(id);
    enqueue(id, 0);
  }

  async function resolve(node: DependencyNode, level: number) {
    const type = node.componentType;
    let table: string;
    let key: string;
    let name: string;
    let unique: string | undefined;
    if (type === referenceType) {
      table = "connectionreferences";
      key = "connectionreferenceid";
      name = "connectionreferencedisplayname";
      unique = "connectionreferencelogicalname";
    } else if (type === 371 || type === 372) {
      table = "connectors";
      key = "connectorid";
      name = "displayname";
      unique = "name";
    } else if (type === 29) {
      table = "workflows";
      key = "workflowid";
      name = "name";
      unique = "uniquename";
    } else if (type === 300) {
      table = "canvasapps";
      key = "canvasappid";
      name = "displayname";
      unique = "name";
    } else if (type === 80) {
      table = "appmodules";
      key = "appmoduleid";
      name = "name";
      unique = "uniquename";
    } else if (type === 60 || type === 24) {
      table = "systemforms";
      key = "formid";
      name = "name";
    } else if (type === 26) {
      table = "savedqueries";
      key = "savedqueryid";
      name = "name";
    } else if (type === 61) {
      table = "webresources";
      key = "webresourceid";
      name = "displayname";
      unique = "name";
    } else if (type === 380) {
      table = "environmentvariabledefinitions";
      key = "environmentvariabledefinitionid";
      name = "displayname";
      unique = "schemaname";
    } else if (type === 1 || (type === 2 && parents.has(node.id))) {
      table =
        type === 1
          ? "EntityDefinitions"
          : `EntityDefinitions(${parents.get(node.id)})/Attributes`;
      key = "MetadataId";
      name = "LogicalName";
    } else return;
    const columns =
      type === referenceType
        ? referenceColumns
        : table === "connectors"
          ? connectorColumns
          : [...new Set([key, name, ...(unique ? [unique] : [])])].join(",");
    const result = await read(
      endpoint(table, {
        $select: columns,
        $filter: `${key} eq ${node.objectId}`,
      }),
      node.id,
      "label",
    );
    if (result === undefined) return;
    if (result.rows.length !== 1) {
      issue(node.id, "label", "unresolved");
      return;
    }
    const row = result.rows[0] ?? {};
    if (guid(text(row, key)) !== node.objectId) {
      issue(node.id, "label", "unrelated-metadata");
      return;
    }
    observed.add(node.id);
    const label =
      nullableText(row, name) ?? (unique ? nullableText(row, unique) : null);
    if (label === null) {
      issue(node.id, "label", "unresolved");
      return;
    }
    nodes.set(node.id, {
      ...node,
      label,
      logicalName: unique
        ? nullableText(row, unique)
        : type === 1 || type === 2
          ? label
          : null,
      labelStatus: "resolved",
      kind:
        type === referenceType
          ? "connection-reference"
          : table === "connectors"
            ? "connector"
            : "component",
    });
    if (type !== referenceType || !bindings || level >= depth) return;
    const reference = referenceFromRow(row);
    function binding(
      kind: "connection" | "connector-api",
      objectId: string,
      relation: "binds-to" | "uses-connector",
    ) {
      const id = `${kind}:${kind === "connection" ? `${encodeURIComponent(reference.connectorApiId ?? reference.customConnectorId ?? reference.id)}:` : ""}${encodeURIComponent(objectId)}`;
      addNode({
        id,
        kind,
        objectId,
        label: objectId,
        logicalName: null,
        componentType: null,
        labelStatus: "unresolved",
        distance: node.distance + 1,
      });
      addEdge({
        from: node.id,
        to: id,
        kind: relation,
        evidence: "connection-reference-metadata",
        dependencyType: null,
      });
    }
    if (reference.connectionId)
      binding("connection", reference.connectionId, "binds-to");
    if (reference.connectorApiId)
      binding("connector-api", reference.connectorApiId, "uses-connector");
    if (reference.customConnectorId) {
      const memberships = await read(
        endpoint("solutioncomponents", {
          $select: "componenttype",
          $filter: `objectid eq ${reference.customConnectorId}`,
        }),
        node.id,
        "custom-connector-type",
        maxNodes + 1,
      );
      const types = [
        ...new Set(
          (memberships?.rows ?? []).map((row) =>
            componentType(row.componenttype),
          ),
        ),
      ];
      if (types.length === 1) {
        const target = addComponent(
          types[0] as number,
          reference.customConnectorId,
          node.distance + 1,
        );
        if (target) {
          addEdge({
            from: node.id,
            to: target,
            kind: "uses-connector",
            evidence: "connection-reference-metadata",
            dependencyType: null,
          });
          enqueue(target, level + 1);
        }
      } else issue(node.id, "custom-connector-type", "unresolved");
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index] as { id: string; depth: number };
    const node = nodes.get(item.id) as DependencyNode;
    if (item.depth < depth) {
      for (const way of directions) {
        const operation =
          way === "required"
            ? "RetrieveRequiredComponents"
            : "RetrieveDependentComponents";
        const result = await read(
          `${operation}(ObjectId=${node.objectId},ComponentType=${node.componentType})`,
          node.id,
          operation,
          maxEdges + 1,
        );
        if (result === undefined || !result.complete) frontier.add(node.id);
        for (const row of result?.rows ?? []) {
          try {
            const dependentType = componentType(row.dependentcomponenttype);
            const requiredType = componentType(row.requiredcomponenttype);
            const dependentId = guid(text(row, "dependentcomponentobjectid"));
            const requiredId = guid(text(row, "requiredcomponentobjectid"));
            if (
              way === "required"
                ? dependentType !== node.componentType ||
                  dependentId !== node.objectId
                : requiredType !== node.componentType ||
                  requiredId !== node.objectId
            ) {
              issue(node.id, operation, "unrelated-dependency");
              continue;
            }
            const dependencyType = row.dependencytype;
            if (
              typeof dependencyType !== "number" ||
              !Number.isSafeInteger(dependencyType) ||
              dependencyType < 0
            )
              throw new Error("Invalid dependency type.");
            const from = addComponent(
              dependentType,
              dependentId,
              node.distance + 1,
              row.dependentcomponentparentid,
            );
            const to = addComponent(
              requiredType,
              requiredId,
              node.distance + 1,
              row.requiredcomponentparentid,
            );
            if (from && to)
              addEdge({
                from,
                to,
                kind: "requires",
                evidence: "dataverse-dependency",
                dependencyType,
              });
            if (from) observed.add(from);
            if (to) observed.add(to);
            enqueue(way === "required" ? to : from, item.depth + 1);
          } catch {
            issue(node.id, operation, "invalid-dependency");
          }
        }
      }
    } else frontier.add(node.id);
    try {
      await resolve(node, item.depth);
    } catch (error) {
      if (error instanceof DataverseError && error.code === "authentication")
        throw error;
      issue(node.id, "label", "invalid-metadata");
    }
  }
  for (const root of roots)
    if (nodes.get(root)?.componentType !== null && !observed.has(root))
      issue(root, "root", "unverified-object");
  const complete = issues.length === 0;
  return {
    graphVersion: 1,
    environment,
    direction,
    roots: roots.sort(),
    nodes: [...nodes.values()].sort(
      (a, b) => a.distance - b.distance || a.id.localeCompare(b.id),
    ),
    edges: [...edges.values()].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
    complete,
    closureComplete: complete && frontier.size === 0,
    frontier: [...frontier].sort(),
    queries,
    issues,
    limitations: [
      "Arrows point from dependent to required component. Membership and connection binding are separate evidence, not invented platform dependencies.",
      "This is a bounded graph of visible declared dependencies, not a runtime trace or proof of safe deletion. Dynamic/external references and resources outside solutions may be absent.",
      "Depth limits leave an unexplored frontier. Permission, service, node, edge, row, or collection-query limits keep coverage incomplete; zero observed consumers is not proof of non-use.",
      "Connection IDs and connector API bindings are opaque metadata; credentials, health, access, DLP, app contents, and flow definitions are not inspected.",
      "The collection-query budget excludes identity calls and counts logical collections, not HTTP pages or safe-read retries. Reads are not a transactional snapshot.",
      "Unknown component types retain typed IDs and dependency evidence even when their labels cannot be resolved.",
    ],
  };
}

function bounded(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new DataverseError(
      "invalid-input",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  return value;
}
function componentType(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw new DataverseError(
      "invalid-input",
      "Component type must be a positive int32 from the selected environment.",
    );
  return value;
}
