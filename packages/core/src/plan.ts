import {
  type Column,
  canonical,
  type DataverseMapping,
  type Entity,
  fingerprint,
  physicalColumn,
  physicalEntity,
  type SchemaModel,
} from "./schema.js";

export interface SchemaEnvironment {
  readonly name: string;
  readonly url: string;
  readonly organizationId: string;
}

export interface ObservedColumn {
  readonly name: string;
  readonly definition: Omit<Column, "name"> | null;
  readonly providerType: string;
}

export interface ObservedEntity {
  readonly name: string;
  readonly metadataId: string;
  readonly primaryKey: string;
  readonly primaryName: string;
  readonly columns: readonly ObservedColumn[];
}

export interface SchemaSnapshot {
  readonly entities: readonly ObservedEntity[];
  readonly externalTargets?: readonly {
    readonly table: string;
    readonly primaryKey: string;
  }[];
}

export type SchemaOperation =
  | { readonly kind: "create-entity"; readonly entity: string }
  | {
      readonly kind: "add-column";
      readonly entity: string;
      readonly column: string;
    };

export interface SchemaPlan {
  readonly planVersion: 1;
  readonly provider: "dataverse";
  readonly environment: SchemaEnvironment;
  readonly mapping: DataverseMapping;
  readonly model: SchemaModel;
  readonly observedFingerprint: string;
  readonly operations: readonly SchemaOperation[];
  readonly blocked: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
  readonly limitations: readonly string[];
}

export async function planSchema(
  model: SchemaModel,
  mapping: DataverseMapping,
  environment: SchemaEnvironment,
  snapshot: SchemaSnapshot,
): Promise<SchemaPlan> {
  const operations: SchemaOperation[] = [];
  const blocked: { path: string; reason: string }[] = [];
  for (const entity of model.entities) {
    const existing = snapshot.entities.find(
      (observed) => observed.name === physicalEntity(mapping, entity),
    );
    if (existing === undefined)
      operations.push({ kind: "create-entity", entity: entity.name });
    else if (
      existing.primaryKey !== `${physicalEntity(mapping, entity)}id` ||
      existing.primaryName !== `${mapping.prefix}_${entity.primaryName}`
    )
      blocked.push({
        path: entity.name,
        reason: "Primary key or primary name mapping differs.",
      });
    for (const column of entity.columns) {
      const path = `${entity.name}.${column.name}`;
      const incompatibility = columnCapability(entity, column);
      if (incompatibility !== null)
        blocked.push({ path, reason: incompatibility });
      if (column.externalReference?.table.startsWith(`${mapping.prefix}_`))
        blocked.push({
          path,
          reason:
            "External targets must be outside the managed prefix; model tables inside the namespace explicitly.",
        });
      if (
        column.externalReference !== undefined &&
        !snapshot.externalTargets?.some(
          (target) => canonical(target) === canonical(column.externalReference),
        )
      )
        blocked.push({
          path,
          reason:
            "External target table or primary key was not verified in this environment.",
        });
      const observed = existing?.columns.find(
        (value) => value.name === physicalColumn(mapping, entity, column),
      );
      if (existing !== undefined && observed === undefined) {
        if (
          column.name === entity.primaryKey ||
          column.name === entity.primaryName
        )
          blocked.push({
            path,
            reason:
              "A primary attribute cannot be added to an existing entity.",
          });
        else
          operations.push({
            kind: "add-column",
            entity: entity.name,
            column: column.name,
          });
      } else if (observed !== undefined) {
        const { name: _name, ...definition } = column;
        if (
          observed.definition === null ||
          canonical(observed.definition) !== canonical(definition)
        )
          blocked.push({
            path,
            reason: `Existing definition differs or has unknown semantics (${observed.providerType}); type and constraint changes are blocked.`,
          });
      }
    }
    for (const column of existing?.columns ?? []) {
      if (
        column.name.startsWith(`${mapping.prefix}_`) &&
        !entity.columns.some(
          (wanted) => physicalColumn(mapping, entity, wanted) === column.name,
        )
      )
        blocked.push({
          path: `${entity.name}.${column.name}`,
          reason: "Removing an existing custom column is blocked.",
        });
    }
  }
  for (const existing of snapshot.entities) {
    if (
      !model.entities.some(
        (entity) => physicalEntity(mapping, entity) === existing.name,
      )
    )
      blocked.push({
        path: existing.name,
        reason: "Removing an existing mapped entity is blocked.",
      });
  }
  return {
    planVersion: 1,
    provider: "dataverse",
    environment,
    mapping,
    model,
    observedFingerprint: await fingerprint(snapshot),
    operations,
    blocked,
    limitations: [
      "RequiredLevel is application-level in Dataverse, not a server-side NOT NULL guarantee.",
      "Only additive metadata changes are supported; unknown or destructive changes are blocked.",
    ],
  };
}

function columnCapability(entity: Entity, column: Column): string | null {
  if (
    column.type === "uuid" &&
    column.name !== entity.primaryKey &&
    column.references === undefined &&
    column.externalReference === undefined
  )
    return "Dataverse custom UUID fields without a relationship are not in the supported mapping.";
  if (
    column.type === "decimal" &&
    ((column.precision ?? 0) > 14 ||
      (column.scale ?? 0) > 10 ||
      (column.precision ?? 0) - (column.scale ?? 0) > 11)
  )
    return "Dataverse decimal precision/range is outside the verified portable subset.";
  if (column.name === entity.primaryName && (column.maxLength ?? 0) > 850)
    return "Dataverse primary-name text is limited to 850 characters.";
  return null;
}
