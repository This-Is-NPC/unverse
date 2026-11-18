import type {
  ArtifactItem,
  ArtifactTypeName,
  ArtifactTypeSpec,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { connectionReferences, connectors } from "./connections.js";
import { apps, flows, solutions, variableDefinitions } from "./discovery.js";
import { tables } from "./query.js";
import { securityRoles } from "./roles.js";

const canvasKinds: Readonly<Record<number, string>> = {
  0: "classic",
  1: "component-library",
  2: "custom-page",
  3: "unified",
  4: "code-app",
  5: "mobile",
};

type Fields = Omit<ArtifactItem, "type" | "source">;

function item(
  type: ArtifactTypeName,
  fields: {
    readonly [key in keyof Fields]: Fields[key] | null | undefined;
  },
): ArtifactItem {
  const present = Object.entries(fields).filter(
    ([, value]) => value !== null && value !== undefined,
  );
  return {
    type,
    ...Object.fromEntries(present),
    source: "dataverse",
  } as ArtifactItem;
}

const readers: Readonly<
  Record<
    ArtifactTypeName,
    (client: DataverseClient) => Promise<readonly ArtifactItem[]>
  >
> = {
  table: async (client) =>
    (await tables(client)).map((row) =>
      item("table", {
        id: row.logicalName,
        name: row.logicalName,
        displayName: row.displayName,
      }),
    ),
  "canvas-app": async (client) =>
    (await apps(client, "canvas")).map((row) =>
      item("canvas-app", {
        id: row.id,
        name: row.uniqueName ?? row.name,
        displayName: row.name,
        owner: row.ownerId,
        managed: row.managed,
        kind:
          row.appType === undefined
            ? "unknown"
            : (canvasKinds[row.appType] ?? "unknown"),
      }),
    ),
  "model-driven-app": async (client) =>
    (await apps(client, "model-driven")).map((row) =>
      item("model-driven-app", {
        id: row.id,
        name: row.uniqueName ?? row.name,
        displayName: row.name,
      }),
    ),
  "cloud-flow": async (client) =>
    (await flows(client)).map((row) =>
      item("cloud-flow", {
        id: row.id,
        name: row.uniqueName ?? row.name,
        displayName: row.name,
        owner: row.ownerId,
        managed: row.managed,
      }),
    ),
  "security-role": async (client) =>
    (await securityRoles(client)).map((row) =>
      item("security-role", {
        id: row.id,
        name: row.name,
        managed: row.managed,
      }),
    ),
  "connection-reference": async (client) =>
    (await connectionReferences(client)).map((row) =>
      item("connection-reference", {
        id: row.id,
        name: row.logicalName,
        displayName: row.name,
        managed: row.managed,
      }),
    ),
  "environment-variable": async (client) =>
    (await variableDefinitions(client)).map((row) =>
      item("environment-variable", {
        id: row.id,
        name: row.schemaName,
        displayName: row.name,
        managed: row.managed,
      }),
    ),
  solution: async (client) =>
    (await solutions(client)).map((row) =>
      item("solution", {
        id: row.id,
        name: row.uniqueName,
        displayName: row.name,
        managed: row.managed,
      }),
    ),
  connector: async (client) =>
    (await connectors(client)).map((row) =>
      item("connector", {
        id: row.id,
        name: row.logicalName,
        displayName: row.name,
        managed: row.managed,
      }),
    ),
};

export async function listArtifacts(
  client: DataverseClient,
  spec: ArtifactTypeSpec,
  limit?: number,
): Promise<{
  readonly items: readonly ArtifactItem[];
  readonly complete: boolean;
}> {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new DataverseError(
      "invalid-input",
      "The row limit must be a positive safe integer.",
    );
  const read = (readers as Record<string, (typeof readers)[ArtifactTypeName]>)[
    spec.type
  ];
  if (read === undefined)
    throw new DataverseError(
      "invalid-input",
      `Unknown artifact type ${spec.type}.`,
    );
  const items = await read(client);
  return limit === undefined || items.length <= limit
    ? { items, complete: true }
    : { items: items.slice(0, limit), complete: false };
}
