import {
  type Column,
  canonical,
  type DataverseMapping,
  fingerprint,
  lookupLimitations,
  type PlanEffect,
  parseManifest,
  parseMapping,
  physicalColumn,
  physicalEntity,
  preservedIdentities,
  record,
  resolveDesired,
  type SchemaEnvironment,
  type TransferManifest,
  verifyTransfer,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { endpoint, guid, identifier, literal, text } from "./odata.js";
import { tables } from "./query.js";
import { assertEnvironment } from "./schema.js";
import { exportTransfer } from "./transfer.js";

export interface DataPlan {
  readonly dataPlanVersion: 1;
  readonly kind: "data";
  readonly effect: PlanEffect;
  readonly purpose: "seed" | "transfer";
  readonly environment: SchemaEnvironment;
  readonly mapping: DataverseMapping;
  readonly manifest: TransferManifest;
  readonly policyFingerprint: string;
  readonly observedFingerprint: string;
  readonly create: readonly { readonly entity: string; readonly id: string }[];
  readonly blocked: readonly {
    readonly entity: string;
    readonly id: string;
    readonly reason: string;
  }[];
  readonly fingerprint: string;
  readonly limitations: readonly string[];
}

export async function planDesired(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
): Promise<DataPlan> {
  const { manifest, mapping, purpose, basis } = await resolveDesired(input);
  if (purpose === "transfer") assertTransferSource(manifest, environment);
  return planData(client, manifest, mapping, environment, purpose, basis);
}

async function planData(
  client: DataverseClient,
  manifest: TransferManifest,
  mapping: DataverseMapping,
  environment: SchemaEnvironment,
  purpose: "seed" | "transfer",
  policyFingerprint: string,
): Promise<DataPlan> {
  const target = await exportTransfer(
    client,
    manifest.model,
    mapping,
    environment,
  );
  const create: { entity: string; id: string }[] = [];
  const blocked: { entity: string; id: string; reason: string }[] = [];
  let operations = 0;
  for (const entity of manifest.model.entities) {
    const current = new Map(
      (target.data[entity.name] ?? []).map((row) => [
        String(row[entity.primaryKey]),
        row,
      ]),
    );
    for (const row of manifest.data[entity.name] ?? []) {
      const id = guid(String(row[entity.primaryKey]));
      const existing = current.get(id);
      if (existing === undefined) {
        create.push({ entity: entity.name, id });
        operations +=
          1 +
          entity.columns.filter(
            (column) =>
              (column.references !== undefined ||
                column.externalReference !== undefined) &&
              row[column.name] !== null,
          ).length;
      } else if (canonical(existing) !== canonical(row))
        blocked.push({
          entity: entity.name,
          id,
          reason:
            "An existing row differs; overwrites and repairs are not authorized.",
        });
    }
  }
  if (operations > 1000)
    throw new DataverseError(
      "unsupported",
      "The dataset exceeds the 1000-operation atomic changeset bound; split the modeled dataset explicitly.",
    );
  const body = {
    dataPlanVersion: 1 as const,
    kind: "data" as const,
    effect: "write" as const,
    purpose,
    environment,
    mapping,
    manifest,
    policyFingerprint,
    observedFingerprint: target.fingerprint,
    create,
    blocked,
    limitations: [
      ...lookupLimitations(manifest.model),
      "Create-only atomic changeset; existing differing rows, deletes, and overwrites are blocked.",
      "The dataset is bounded to 1000 operations and 4 MB. Resume means re-plan and verify, not per-row checkpoints.",
      "A lost response has an unknown outcome until inspection. No write is retried automatically.",
      "A field copy policy is an explicit authorization, not automatic detection of personal or sensitive data.",
    ],
  };
  return { ...body, fingerprint: await fingerprint(body) };
}

async function readDataPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
) {
  const value = record(input);
  if (
    value.dataPlanVersion !== 1 ||
    value.kind !== "data" ||
    !["seed", "transfer"].includes(String(value.purpose)) ||
    canonical(value.environment) !== canonical(environment)
  )
    throw new DataverseError(
      "invalid-input",
      "Data plan is invalid or belongs to another environment.",
    );
  await assertEnvironment(client, environment);
  const { fingerprint: digest, ...body } = value;
  if ((await fingerprint(body)) !== digest)
    throw new DataverseError("invalid-input", "The data plan was modified.");
  const manifest = await parseManifest(value.manifest);
  if (value.purpose === "transfer") assertTransferSource(manifest, environment);
  const mapping = parseMapping(value.mapping);
  const expected = await planData(
    client,
    manifest,
    mapping,
    environment,
    value.purpose as "seed" | "transfer",
    String(value.policyFingerprint),
  );
  return { manifest, mapping, expected };
}

export async function verifyDataPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
) {
  const { expected } = await readDataPlan(client, input, environment);
  return {
    kind: "data" as const,
    satisfied: expected.create.length === 0 && expected.blocked.length === 0,
    create: expected.create,
    blocked: expected.blocked,
  };
}

export async function applyDataPlan(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
  confirm: boolean,
) {
  if (!confirm)
    throw new DataverseError(
      "invalid-input",
      "Data apply requires explicit --confirm.",
    );
  const { manifest, mapping, expected } = await readDataPlan(
    client,
    input,
    environment,
  );
  if (expected.blocked.length)
    throw new DataverseError(
      "invalid-input",
      "Data plan contains conflicting existing rows; no writes were issued.",
    );
  if (expected.create.length === 0)
    return verifyData(
      client,
      manifest,
      mapping,
      environment,
      "verified-resume",
    );
  if (canonical(expected) !== canonical(input))
    throw new DataverseError(
      "invalid-input",
      "The data plan is stale; inspect and re-plan.",
    );
  const definitions = await tables(client);
  const sets = new Map(
    manifest.model.entities.map((entity) => {
      const definition = definitions.find(
        (table) => table.logicalName === physicalEntity(mapping, entity),
      );
      if (definition?.entitySet === null || definition?.entitySet === undefined)
        throw new DataverseError(
          "unsupported",
          "A modeled table has no entity set.",
        );
      return [entity.name, identifier(definition.entitySet)];
    }),
  );
  const referenceSet = (column: Column) => {
    const set =
      column.externalReference === undefined
        ? sets.get(String(column.references))
        : definitions.find(
            (table) => table.logicalName === column.externalReference?.table,
          )?.entitySet;
    if (set === undefined || set === null)
      throw new DataverseError(
        "unsupported",
        "A referenced table has no entity set.",
      );
    return identifier(set);
  };
  const operations: {
    path: string;
    createOnly: boolean;
    body: Record<string, unknown>;
  }[] = [];
  const links: typeof operations = [];
  for (const entity of manifest.model.entities) {
    const navigations = new Map<string, string>();
    for (const column of entity.columns)
      if (column.references !== undefined || column.externalReference) {
        const result = await client.collect(
          endpoint(
            "RelationshipDefinitions/Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
            {
              $select:
                "ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity",
              $filter: `ReferencingEntity eq ${literal(physicalEntity(mapping, entity))} and ReferencingAttribute eq ${literal(physicalColumn(mapping, entity, column))}`,
            },
          ),
        );
        if (
          result.rows.length !== 1 ||
          result.rows[0]?.ReferencedEntity !==
            (column.externalReference?.table ??
              `${mapping.prefix}_${column.references}`)
        )
          throw new DataverseError(
            "unsupported",
            "Relationship navigation is missing or ambiguous.",
          );
        navigations.set(
          column.name,
          identifier(
            text(
              result.rows[0] ?? {},
              "ReferencingEntityNavigationPropertyName",
            ),
          ),
        );
      }
    for (const row of manifest.data[entity.name] ?? []) {
      const id = String(row[entity.primaryKey]);
      if (
        !expected.create.some(
          (candidate) =>
            candidate.entity === entity.name && candidate.id === id,
        )
      )
        continue;
      const path = `${sets.get(entity.name)}(${guid(id)})`;
      const values: Record<string, unknown> = {};
      for (const column of entity.columns) {
        const value = row[column.name];
        if (column.name === entity.primaryKey) continue;
        if (column.references === undefined && !column.externalReference)
          values[physicalColumn(mapping, entity, column)] =
            value !== null && column.type === "decimal" ? Number(value) : value;
        else if (value !== null)
          links.push({
            path,
            createOnly: false,
            body: {
              [`${navigations.get(column.name)}@odata.bind`]: `/${referenceSet(column)}(${guid(String(value))})`,
            },
          });
      }
      operations.push({ path, createOnly: true, body: values });
    }
  }
  await client.atomicBatch([...operations, ...links]);
  return verifyData(client, manifest, mapping, environment, "committed");
}

async function verifyData(
  client: DataverseClient,
  manifest: TransferManifest,
  mapping: DataverseMapping,
  environment: SchemaEnvironment,
  checkpoint: string,
) {
  const target = await exportTransfer(
    client,
    manifest.model,
    mapping,
    environment,
  );
  const selected = Object.fromEntries(
    manifest.model.entities.map((entity) => {
      const ids = new Set(
        (manifest.data[entity.name] ?? []).map((row) => row[entity.primaryKey]),
      );
      return [
        entity.name,
        (target.data[entity.name] ?? []).filter((row) =>
          ids.has(row[entity.primaryKey]),
        ),
      ];
    }),
  );
  return {
    ...verifyTransfer(manifest, selected, preservedIdentities(manifest)),
    target: environment,
    checkpoint: {
      unit: "atomic-changeset",
      fingerprint: manifest.fingerprint,
      state: checkpoint,
    },
  };
}

function assertTransferSource(
  manifest: TransferManifest,
  environment: SchemaEnvironment,
): void {
  if (
    manifest.source.environment.url === environment.url ||
    manifest.source.environment.organizationId === environment.organizationId
  )
    throw new DataverseError(
      "invalid-input",
      "Dataverse transfer requires a distinct source and target organization.",
    );
}
