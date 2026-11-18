import type { PlanEffect } from "./plan-header.js";
import {
  type Column,
  canonical,
  type DataverseMapping,
  type Entity,
  fingerprint,
  physicalColumn,
  physicalEntity,
  physicalKey,
  type SchemaModel,
} from "./schema.js";
import {
  type ObservedSolutionComponents,
  planSolutionComponents,
  type SolutionComponentOperation,
} from "./solution-components.js";

export interface SchemaEnvironment {
  readonly name: string;
  readonly url: string;
  readonly organizationId: string;
}

export interface ObservedColumn {
  readonly name: string;
  readonly definition: Omit<Column, "name"> | null;
  readonly providerType: string;
  readonly data?: {
    readonly holdsData: boolean | "unknown";
    readonly evidence: string;
  };
}

export interface ObservedKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly indexStatus: string;
}

export interface ObservedEntity {
  readonly name: string;
  readonly metadataId: string;
  readonly primaryKey: string;
  readonly primaryName: string;
  readonly columns: readonly ObservedColumn[];
  readonly keys: readonly ObservedKey[];
}

export interface SchemaSnapshot {
  readonly solutionComponents?: ObservedSolutionComponents;
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
    }
  | {
      readonly kind: "add-option";
      readonly entity: string;
      readonly column: string;
      readonly value: number;
      readonly label: string;
    }
  | {
      readonly kind: "create-key";
      readonly entity: string;
      readonly key: string;
    }
  | SolutionComponentOperation;

export interface BlockedChange {
  readonly path: string;
  readonly reason: string;
  readonly holdsData?: boolean | "unknown";
  readonly evidence?: string;
}

export interface SchemaPlan {
  readonly planVersion: 1;
  readonly kind: "schema";
  readonly effect: PlanEffect;
  readonly provider: "dataverse";
  readonly environment: SchemaEnvironment;
  readonly mapping: DataverseMapping;
  readonly model: SchemaModel;
  readonly observedFingerprint: string;
  readonly operations: readonly SchemaOperation[];
  readonly blocked: readonly BlockedChange[];
  readonly unverified: readonly {
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
  const blocked: BlockedChange[] = [];
  const keyOperations: SchemaOperation[] = [];
  const unverified: { path: string; reason: string }[] = [];
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
        const additions =
          observed.definition === null
            ? null
            : optionAdditions(observed.definition, definition);
        if (additions === null)
          blocked.push({
            path,
            reason: `Existing definition differs or has unknown semantics (${observed.providerType}); type and constraint changes are blocked.`,
          });
        else
          for (const option of additions)
            operations.push({
              kind: "add-option",
              entity: entity.name,
              column: column.name,
              ...option,
            });
      }
    }
    for (const column of ownedColumnsOutsideModel(
      mapping,
      entity,
      existing?.columns ?? [],
    ))
      blocked.push({
        path: `${entity.name}.${column.name}`,
        reason: "Removing an existing custom column is blocked.",
        ...(column.data === undefined
          ? {}
          : {
              holdsData: column.data.holdsData,
              evidence: column.data.evidence,
            }),
      });
    for (const key of entity.keys ?? []) {
      const path = `${entity.name}.keys.${key.name}`;
      const schemaName = physicalKey(mapping, key);
      const columns = key.columns.map((name) =>
        physicalColumn(
          mapping,
          entity,
          entity.columns.find((column) => column.name === name) as Column,
        ),
      );
      const observed = existing?.keys.find(
        (value) => value.name === schemaName,
      );
      const twin = existing?.keys.find(
        (value) => sameColumns(value.columns, columns) && value !== observed,
      );
      if (twin !== undefined)
        blocked.push({
          path,
          reason: `Another key (${twin.name}) already uses these columns; renaming a key is blocked.`,
        });
      else if (observed === undefined)
        keyOperations.push({
          kind: "create-key",
          entity: entity.name,
          key: key.name,
        });
      else if (!sameColumns(observed.columns, columns))
        blocked.push({
          path,
          reason: "Existing key columns differ; changing a key is blocked.",
        });
      else if (observed.indexStatus !== "Active")
        unverified.push({
          path,
          reason: `The key index status is ${observed.indexStatus}, not Active.`,
        });
    }
    for (const observed of existing?.keys ?? [])
      if (
        observed.name.startsWith(`${mapping.prefix}_`) &&
        !entity.keys?.some((key) => physicalKey(mapping, key) === observed.name)
      )
        blocked.push({
          path: `${entity.name}.keys.${observed.name}`,
          reason: "Removing an existing custom key is blocked.",
        });
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
  const components = planSolutionComponents(
    mapping.prefix,
    mapping,
    snapshot.solutionComponents,
  );
  operations.push(...components.operations);
  blocked.push(...components.blocked);
  return {
    planVersion: 1,
    kind: "schema",
    effect: "write",
    provider: "dataverse",
    environment,
    mapping,
    model,
    observedFingerprint: await fingerprint(snapshot),
    operations: [...operations, ...keyOperations],
    blocked,
    unverified,
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

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return canonical([...a].sort()) === canonical([...b].sort());
}

type Definition = Omit<Column, "name">;

function optionAdditions(
  observed: Definition,
  declared: Definition,
): NonNullable<Column["options"]> | null {
  const { options: have = [], ...observedRest } = observed;
  const { options: want = [], ...declaredRest } = declared;
  if (
    canonical(observedRest) !== canonical(declaredRest) ||
    have.some(
      (option) =>
        !want.some(
          (wanted) =>
            wanted.value === option.value && wanted.label === option.label,
        ),
    )
  )
    return null;
  return want.filter(
    (wanted) => !have.some((option) => option.value === wanted.value),
  );
}

export function ownedColumnsOutsideModel(
  mapping: DataverseMapping,
  entity: Entity,
  columns: readonly ObservedColumn[],
): ObservedColumn[] {
  return columns.filter(
    (column) =>
      column.name.startsWith(`${mapping.prefix}_`) &&
      !entity.columns.some(
        (wanted) => physicalColumn(mapping, entity, wanted) === column.name,
      ),
  );
}
