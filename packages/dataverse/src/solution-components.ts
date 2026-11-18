import {
  connectionReferenceName,
  connectorId,
  type DataverseMapping,
  type ObservedSolutionComponents,
  type SolutionComponentOperation,
  textVariableType,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { endpoint, literal, nullableText, text } from "./odata.js";

export async function inspectSolutionComponents(
  client: DataverseClient,
  mapping: DataverseMapping,
): Promise<ObservedSolutionComponents | undefined> {
  if (
    mapping.environmentVariables === undefined &&
    mapping.connectionReferences === undefined
  )
    return undefined;
  const environmentVariables = [];
  for (const variable of mapping.environmentVariables ?? []) {
    const rows = await single(
      client,
      "environmentvariabledefinitions",
      "schemaname,displayname,type,defaultvalue",
      `schemaname eq ${literal(variable.schemaName)}`,
    );
    if (rows === undefined) continue;
    const type = rows.type;
    environmentVariables.push({
      schemaName: text(rows, "schemaname"),
      displayName: text(rows, "displayname"),
      providerType: typeof type === "number" ? type : -1,
      defaultMatches:
        (nullableText(rows, "defaultvalue") ?? undefined) ===
        variable.defaultValue,
    });
  }
  const connectionReferences = [];
  for (const reference of mapping.connectionReferences ?? []) {
    const logicalName = connectionReferenceName(
      mapping.prefix,
      reference.displayName,
    );
    const rows = await single(
      client,
      "connectionreferences",
      "connectionreferencelogicalname,connectorid",
      `connectionreferencelogicalname eq ${literal(logicalName)}`,
    );
    if (rows !== undefined)
      connectionReferences.push({
        logicalName: text(rows, "connectionreferencelogicalname"),
        connectorId: nullableText(rows, "connectorid") ?? "",
      });
  }
  return { environmentVariables, connectionReferences };
}

export async function createSolutionComponents(
  client: DataverseClient,
  mapping: DataverseMapping,
  operations: readonly SolutionComponentOperation[],
  headers: Readonly<Record<string, string>>,
): Promise<void> {
  for (const operation of operations) {
    if (operation.kind === "create-environment-variable") {
      const variable = mapping.environmentVariables?.find(
        (candidate) => candidate.schemaName === operation.schemaName,
      );
      if (variable === undefined)
        throw new DataverseError(
          "invalid-input",
          "Plan environment variable is missing.",
        );
      await client.write(
        "POST",
        "environmentvariabledefinitions",
        {
          schemaname: variable.schemaName,
          displayname: variable.displayName,
          type: textVariableType,
          ...(variable.defaultValue === undefined
            ? {}
            : { defaultvalue: variable.defaultValue }),
        },
        headers,
      );
    } else {
      const reference = mapping.connectionReferences?.find(
        (candidate) =>
          connectionReferenceName(mapping.prefix, candidate.displayName) ===
          operation.logicalName,
      );
      if (reference === undefined)
        throw new DataverseError(
          "invalid-input",
          "Plan connection reference is missing.",
        );
      await client.write(
        "POST",
        "connectionreferences",
        {
          connectionreferencelogicalname: operation.logicalName,
          connectionreferencedisplayname: reference.displayName,
          connectorid: connectorId(reference.connector),
        },
        headers,
      );
    }
  }
}

async function single(
  client: DataverseClient,
  entitySet: string,
  select: string,
  filter: string,
): Promise<Record<string, unknown> | undefined> {
  const { rows } = await client.collect(
    endpoint(entitySet, { $select: select, $filter: filter }),
  );
  if (rows.length > 1)
    throw new DataverseError(
      "service",
      `${entitySet} returned several rows for one unique name.`,
    );
  return rows[0];
}
