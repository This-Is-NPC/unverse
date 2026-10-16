import { type DataverseClient, DataverseError } from "./client.js";
import { matches, solutionComponents } from "./discovery.js";
import { endpoint, guid, nullableText, text } from "./odata.js";

export const referenceColumns =
  "connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname,connectorid,connectionid,_customconnectorid_value,statecode,ismanaged";
export const connectorColumns =
  "connectorid,name,displayname,connectorinternalid,connectortype,statecode,ismanaged";

export function referenceFromRow(row: Record<string, unknown>) {
  const connectionId = nullableText(row, "connectionid");
  return {
    id: guid(text(row, "connectionreferenceid")),
    logicalName: text(row, "connectionreferencelogicalname"),
    name: text(row, "connectionreferencedisplayname"),
    connectorApiId: nullableText(row, "connectorid"),
    customConnectorId: nullableGuid(row, "_customconnectorid_value"),
    connectionId,
    linked: connectionId !== null && connectionId !== "",
    state: integer(row, "statecode"),
    managed: boolean(row, "ismanaged"),
    health: "not-checked" as const,
  };
}

export function connectorFromRow(row: Record<string, unknown>) {
  return {
    id: guid(text(row, "connectorid")),
    logicalName: text(row, "name"),
    name: text(row, "displayname"),
    internalId: nullableText(row, "connectorinternalid"),
    connectorType: integer(row, "connectortype"),
    state: integer(row, "statecode"),
    managed: boolean(row, "ismanaged"),
  };
}

export async function connectionReferences(
  client: DataverseClient,
  options: {
    readonly search?: string;
    readonly solutionId?: string;
    readonly id?: string;
  } = {},
) {
  if (options.id !== undefined) guid(options.id);
  const components =
    options.solutionId === undefined
      ? undefined
      : await solutionComponents(client, options.solutionId);
  const rows = await client.collect(
    endpoint("connectionreferences", {
      $select: referenceColumns,
      ...(options.id === undefined
        ? {}
        : { $filter: `connectionreferenceid eq ${guid(options.id)}` }),
    }),
  );
  return rows.rows
    .map(referenceFromRow)
    .filter(
      (row) =>
        (components === undefined ||
          components.some(
            (component) => component.objectId?.toLowerCase() === row.id,
          )) &&
        matches(options.search, row.name, row.logicalName, row.connectorApiId),
    )
    .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
}

export async function connectors(
  client: DataverseClient,
  options: { readonly search?: string; readonly solutionId?: string } = {},
) {
  const components =
    options.solutionId === undefined
      ? undefined
      : await solutionComponents(client, options.solutionId);
  const rows = await client.collect(
    endpoint("connectors", { $select: connectorColumns }),
  );
  return rows.rows
    .map(connectorFromRow)
    .filter(
      (row) =>
        (components === undefined ||
          components.some(
            (component) => component.objectId?.toLowerCase() === row.id,
          )) &&
        matches(options.search, row.name, row.logicalName, row.internalId),
    )
    .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
}

function nullableGuid(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = nullableText(row, key);
  return value === null ? null : guid(value);
}
function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new DataverseError(
      "service",
      `Connection metadata is missing ${key}.`,
    );
  return value;
}
function boolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean")
    throw new DataverseError(
      "service",
      `Connection metadata is missing ${key}.`,
    );
  return value;
}
