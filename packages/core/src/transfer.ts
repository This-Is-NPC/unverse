import type { SchemaEnvironment } from "./plan.js";
import {
  canonical,
  type DataverseMapping,
  fingerprint,
  parseMapping,
  parseModel,
  record,
  SchemaError,
  type SchemaModel,
} from "./schema.js";
import { type Dataset, normalizeDataset } from "./values.js";

export interface TransferManifest {
  readonly transferVersion: 1;
  readonly source: {
    readonly provider: "dataverse";
    readonly environment: SchemaEnvironment;
    readonly mapping: DataverseMapping;
  };
  readonly model: SchemaModel;
  readonly data: Dataset;
  readonly policy: {
    readonly ids: "preserve";
    readonly cycles: "entities-then-links";
    readonly decimals: "fixed-scale-strings";
    readonly instants: "utc-seconds";
  };
  readonly fingerprint: string;
}

export type IdentityMap = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

export interface TransferVerification {
  readonly verified: boolean;
  readonly fingerprint: string;
  readonly sourceCounts: Readonly<Record<string, number>>;
  readonly targetCounts: Readonly<Record<string, number>>;
  readonly identities: IdentityMap;
  readonly differences: readonly {
    readonly kind: string;
    readonly entity: string;
    readonly column?: string;
  }[];
  readonly limitations: readonly string[];
}

export async function createManifest(
  model: SchemaModel,
  input: unknown,
  environment: SchemaEnvironment,
  mapping: DataverseMapping,
): Promise<TransferManifest> {
  const data = normalizeDataset(model, input);
  const body = {
    transferVersion: 1 as const,
    source: { provider: "dataverse" as const, environment, mapping },
    model,
    data,
    policy: {
      ids: "preserve" as const,
      cycles: "entities-then-links" as const,
      decimals: "fixed-scale-strings" as const,
      instants: "utc-seconds" as const,
    },
  };
  return { ...body, fingerprint: await fingerprint(body) };
}

export async function parseManifest(input: unknown): Promise<TransferManifest> {
  const value = record(input);
  const source = record(value.source);
  const environment = record(source.environment);
  if (
    value.transferVersion !== 1 ||
    source.provider !== "dataverse" ||
    [environment.name, environment.url, environment.organizationId].some(
      (field) => typeof field !== "string" || field === "",
    )
  )
    throw new SchemaError(
      "invalid-input",
      "Invalid transfer source or version.",
    );
  const expected = await createManifest(
    parseModel(value.model),
    value.data,
    environment as unknown as SchemaEnvironment,
    parseMapping(source.mapping),
  );
  if (canonical(expected) !== canonical(input))
    throw new SchemaError(
      "invalid-input",
      "The manifest is modified, invalid, or not in canonical form.",
    );
  return expected;
}

export function preservedIdentities(manifest: TransferManifest): IdentityMap {
  return Object.fromEntries(
    manifest.model.entities.map((entity) => [
      entity.name,
      Object.fromEntries(
        (manifest.data[entity.name] ?? []).map((row) => [
          String(row[entity.primaryKey]),
          String(row[entity.primaryKey]),
        ]),
      ),
    ]),
  );
}

export function verifyTransfer(
  manifest: TransferManifest,
  input: unknown,
  identities: IdentityMap,
): TransferVerification {
  const differences: { kind: string; entity: string; column?: string }[] = [];
  const sourceCounts: Record<string, number> = {};
  const targetCounts: Record<string, number> = {};
  if (
    Object.keys(identities).some(
      (name) => !manifest.model.entities.some((entity) => entity.name === name),
    )
  )
    differences.push({ kind: "identity-map-entity", entity: "dataset" });
  let target: Dataset;
  try {
    target = normalizeDataset(manifest.model, input);
  } catch {
    return {
      verified: false,
      fingerprint: manifest.fingerprint,
      sourceCounts: {},
      targetCounts: {},
      identities,
      differences: [
        { kind: "invalid-data-or-relationship", entity: "dataset" },
      ],
      limitations,
    };
  }
  for (const entity of manifest.model.entities) {
    const expected = manifest.data[entity.name] ?? [];
    const actual = target[entity.name] ?? [];
    const byId = new Map(actual.map((row) => [row[entity.primaryKey], row]));
    sourceCounts[entity.name] = expected.length;
    targetCounts[entity.name] = actual.length;
    if (
      !Object.hasOwn(identities, entity.name) ||
      Object.keys(identities[entity.name] ?? {}).length !== expected.length
    )
      differences.push({ kind: "identity-map-count", entity: entity.name });
    if (expected.length !== actual.length)
      differences.push({ kind: "row-count", entity: entity.name });
    for (const row of expected) {
      const id = String(row[entity.primaryKey]);
      const mapped = identities[entity.name]?.[id];
      if (mapped !== id)
        differences.push({ kind: "identity-mapping", entity: entity.name });
      const match = byId.get(id);
      if (match === undefined) {
        differences.push({ kind: "identity", entity: entity.name });
        continue;
      }
      for (const column of entity.columns) {
        if (canonical(row[column.name]) !== canonical(match[column.name]))
          differences.push({
            kind:
              column.references !== undefined
                ? "relationship"
                : column.type === "decimal"
                  ? "decimal"
                  : column.type === "date" || column.type === "instant"
                    ? "temporal"
                    : "value",
            entity: entity.name,
            column: column.name,
          });
      }
    }
  }
  return {
    verified: differences.length === 0,
    fingerprint: manifest.fingerprint,
    sourceCounts,
    targetCounts,
    identities,
    differences,
    limitations,
  };
}

const limitations = [
  "Required values are checked by the transfer; Dataverse required levels are application-level while PostgreSQL enforces NOT NULL.",
  "This verifies modeled rows and declared invariants, not workflows, plugins, access policies, files, auditing, or a complete platform migration.",
  "Dataverse exports are not a cross-page transactional snapshot.",
];
