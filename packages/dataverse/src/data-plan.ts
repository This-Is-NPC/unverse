import {
  applyDataPolicy,
  buildSeed,
  canonical,
  createManifest,
  type DataverseMapping,
  fingerprint,
  parseManifest,
  parseMapping,
  physicalColumn,
  physicalEntity,
  preservedIdentities,
  record,
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

export async function planSeed(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
): Promise<DataPlan> {
  const seed = await buildSeed(input);
  const manifest = await createManifest(
    seed.model,
    seed.data,
    {
      name: "synthetic",
      url: "https://synthetic.invalid",
      organizationId: seed.namespaceFingerprint,
    },
    seed.mapping,
  );
  return planData(
    client,
    manifest,
    seed.mapping,
    environment,
    "seed",
    seed.namespaceFingerprint,
  );
}

export async function planDataverseTransfer(
  client: DataverseClient,
  input: unknown,
  policy: unknown,
  mapping: DataverseMapping,
  environment: SchemaEnvironment,
): Promise<DataPlan> {
  const manifest = await parseManifest(input);
  assertTransferSource(manifest, environment);
  const transformed = await createManifest(
    manifest.model,
    applyDataPolicy(manifest.model, manifest.data, policy),
    manifest.source.environment,
    manifest.source.mapping,
  );
  return planData(
    client,
    transformed,
    parseMapping(mapping),
    environment,
    "transfer",
    await fingerprint(policy),
  );
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
              column.references !== undefined && row[column.name] !== null,
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
    purpose,
    environment,
    mapping,
    manifest,
    policyFingerprint,
    observedFingerprint: target.fingerprint,
    create,
    blocked,
    limitations: [
      "Create-only atomic changeset; existing differing rows, deletes, and overwrites are blocked.",
      "The dataset is bounded to 1000 operations and 4 MB. Resume means re-plan and verify, not per-row checkpoints.",
      "A lost response has an unknown outcome until inspection. No write is retried automatically.",
      "A field copy policy is an explicit authorization, not automatic detection of personal or sensitive data.",
    ],
  };
  return { ...body, fingerprint: await fingerprint(body) };
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
  const value = record(input);
  if (
    value.dataPlanVersion !== 1 ||
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
  const operations: {
    path: string;
    createOnly: boolean;
    body: Record<string, unknown>;
  }[] = [];
  const links: typeof operations = [];
  for (const entity of manifest.model.entities) {
    const navigations = new Map<string, string>();
    for (const column of entity.columns)
      if (column.references !== undefined) {
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
            `${mapping.prefix}_${column.references}`
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
        if (column.references === undefined)
          values[physicalColumn(mapping, entity, column)] =
            value !== null && column.type === "decimal" ? Number(value) : value;
        else if (value !== null)
          links.push({
            path,
            createOnly: false,
            body: {
              [`${navigations.get(column.name)}@odata.bind`]: `/${sets.get(column.references)}(${guid(String(value))})`,
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
