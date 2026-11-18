import {
  type ArtifactCheck,
  type ArtifactDeclarations,
  type ArtifactItem,
  type ArtifactTypeName,
  type ArtifactUnknown,
  checkArtifacts,
  findArtifactType,
  findUserType,
  isSystemSolution,
  type MemberItem,
  type MemberSolution,
  needsMembership,
  selectArtifacts,
  type UserArtifactType,
} from "@unverse/core";
import { capItems, checkLimit, listArtifacts } from "./artifacts.js";
import { type DataverseClient, DataverseError } from "./client.js";
import { endpoint, guid, nullableText, text } from "./odata.js";

function componentTypeOf(type: ArtifactTypeName): number {
  const componentType = findArtifactType(type)?.componentType;
  if (componentType === undefined)
    throw new DataverseError(
      "unsupported",
      `Artifact type ${type} has no solution component type.`,
    );
  return componentType;
}

const key = (componentType: number, objectId: string) =>
  `${componentType}:${objectId.toLowerCase()}`;

async function membershipIndex(
  client: DataverseClient,
  componentTypes: readonly number[],
): Promise<ReadonlyMap<string, readonly MemberSolution[]>> {
  const solutionRows = await client.collect(
    endpoint("solutions", {
      $select: "solutionid,uniquename,ismanaged",
      $expand: "publisherid($select=customizationprefix)",
    }),
  );
  const byId = new Map<string, MemberSolution>();
  for (const row of solutionRows.rows) {
    const uniqueName = text(row, "uniquename");
    if (isSystemSolution(uniqueName)) continue;
    const publisher = row.publisherid as Record<string, unknown> | null;
    byId.set(guid(text(row, "solutionid")), {
      uniqueName,
      managed: row.ismanaged === true,
      publisher:
        publisher === null || publisher === undefined
          ? null
          : nullableText(publisher, "customizationprefix"),
    });
  }
  const components = await client.collect(
    endpoint("solutioncomponents", {
      $select: "objectid,componenttype,_solutionid_value",
      $filter: componentTypes
        .map((componentType) => `componenttype eq ${componentType}`)
        .join(" or "),
    }),
  );
  const index = new Map<string, MemberSolution[]>();
  for (const row of components.rows) {
    const solution = byId.get(guid(text(row, "_solutionid_value")));
    if (solution === undefined) continue;
    const entry = key(Number(row.componenttype), text(row, "objectid"));
    index.set(entry, [...(index.get(entry) ?? []), solution]);
  }
  for (const solutions of index.values())
    solutions.sort((a, b) => a.uniqueName.localeCompare(b.uniqueName));
  return index;
}

async function tableObjectIds(
  client: DataverseClient,
): Promise<ReadonlyMap<string, string>> {
  const result = await client.collect(
    endpoint("EntityDefinitions", { $select: "LogicalName,MetadataId" }),
  );
  return new Map(
    result.rows.map((row) => [
      text(row, "LogicalName"),
      text(row, "MetadataId"),
    ]),
  );
}

async function attachMembership(
  client: DataverseClient,
  inventories: ReadonlyMap<ArtifactTypeName, readonly ArtifactItem[]>,
): Promise<ReadonlyMap<ArtifactTypeName, readonly MemberItem[]>> {
  const types = [...inventories.keys()];
  if (types.length === 0) return new Map();
  const known = await membershipIndex(client, types.map(componentTypeOf));
  const tables = types.includes("table")
    ? await tableObjectIds(client)
    : new Map<string, string>();
  const attached = new Map<ArtifactTypeName, readonly MemberItem[]>();
  for (const type of types) {
    const members: MemberItem[] = [];
    for (const item of inventories.get(type) ?? [])
      members.push({
        ...item,
        solutions:
          known.get(
            key(
              componentTypeOf(type),
              type === "table" ? (tables.get(item.id) ?? "") : item.id,
            ),
          ) ?? [],
      });
    attached.set(type, members);
  }
  return attached;
}

async function readDeclaredArtifacts(
  client: DataverseClient,
  declarations: ArtifactDeclarations,
  names: readonly string[],
): Promise<ReadonlyMap<string, readonly MemberItem[]>> {
  const declared = names.map((name) => {
    const type = findUserType(declarations, name);
    if (type === undefined)
      throw new DataverseError(
        "invalid-input",
        `Unknown declared artifact type ${name}.`,
      );
    return type;
  });
  const bases = new Map<ArtifactTypeName, readonly ArtifactItem[]>();
  for (const { from } of declared) {
    const spec = findArtifactType(from);
    if (spec !== undefined && !bases.has(from))
      bases.set(from, (await listArtifacts(client, spec)).items);
  }
  const withMembership = await attachMembership(
    client,
    new Map(
      [...bases].filter(([from]) =>
        declared.some(
          (type) => type.from === from && needsMembership(declarations, type),
        ),
      ),
    ),
  );
  return new Map(
    declared.map((type) => [
      type.type,
      withMembership.get(type.from) ?? bases.get(type.from) ?? [],
    ]),
  );
}

export async function listDeclaredArtifacts(
  client: DataverseClient,
  declarations: ArtifactDeclarations,
  name: string,
  limit?: number,
): Promise<{
  readonly items: readonly MemberItem[];
  readonly complete: boolean;
  readonly unknown: readonly ArtifactUnknown[];
}> {
  checkLimit(limit);
  const inventory = await readDeclaredArtifacts(client, declarations, [name]);
  const { selected, unknown } = selectArtifacts(
    findUserType(declarations, name) as UserArtifactType,
    inventory.get(name) ?? [],
  );
  return { ...capItems(selected, limit), unknown };
}

export async function checkDeclaredArtifacts(
  client: DataverseClient,
  declarations: ArtifactDeclarations,
  name?: string,
): Promise<ArtifactCheck> {
  const names =
    name === undefined
      ? declarations.types
          .filter((type) => declarations.rules.has(type.type))
          .map((type) => type.type)
      : [name];
  return checkArtifacts(
    declarations,
    await readDeclaredArtifacts(client, declarations, names),
  );
}
