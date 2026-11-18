import type { SchemaEnvironment } from "./plan.js";
import {
  type DataverseMapping,
  fingerprint,
  parseMapping,
  parseModel,
  record,
  SchemaError,
  type SchemaModel,
} from "./schema.js";
import { applyDataPolicy, buildSeed } from "./seed.js";
import {
  createManifest,
  parseManifest,
  type TransferManifest,
} from "./transfer.js";

/** What a pipeline returns: the rows the target should hold, with their IDs. */
export interface DesiredData {
  readonly model: SchemaModel;
  readonly mapping: DataverseMapping;
  readonly data: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** Present only for rows read from another organization. */
  readonly source?: {
    readonly environment: SchemaEnvironment;
    readonly mapping: DataverseMapping;
  };
  /** Identifies what determined the rows; defaults to the dataset fingerprint. */
  readonly basis?: string;
  /** What to do with a target row that differs; defaults to blocking. */
  readonly onExisting?: OnExisting;
  /** Plan the deletion of exactly these rows instead of writing them. */
  readonly purge?: boolean;
}

export type OnExisting = "block" | "update";

export interface ResolvedData {
  readonly manifest: TransferManifest;
  readonly mapping: DataverseMapping;
  readonly purpose: "seed" | "transfer";
  readonly basis: string;
  readonly onExisting: OnExisting;
  readonly purge: boolean;
}

const desiredKeys = [
  "model",
  "mapping",
  "data",
  "source",
  "basis",
  "onExisting",
  "purge",
];

export async function resolveDesired(input: unknown): Promise<ResolvedData> {
  const desired = record(input);
  if (
    Object.keys(desired).some((key) => !desiredKeys.includes(key)) ||
    (desired.basis !== undefined &&
      (typeof desired.basis !== "string" || desired.basis === ""))
  )
    throw new SchemaError(
      "invalid-input",
      "Desired data has a model, mapping, data, and optional source, basis, onExisting, and purge.",
    );
  if (
    desired.onExisting !== undefined &&
    desired.onExisting !== "block" &&
    desired.onExisting !== "update"
  )
    throw new SchemaError(
      "invalid-input",
      "onExisting must be block or update.",
    );
  const purge = desired.purge ?? false;
  if (
    typeof purge !== "boolean" ||
    (purge && (desired.source !== undefined || desired.onExisting === "update"))
  )
    throw new SchemaError(
      "invalid-input",
      "purge is a boolean that applies to seed data without source or onExisting update.",
    );
  const model = parseModel(desired.model);
  const mapping = parseMapping(desired.mapping);
  const basis =
    desired.basis === undefined
      ? await fingerprint(desired.data)
      : desired.basis;
  let environment: SchemaEnvironment = {
    name: "synthetic",
    url: "https://synthetic.invalid",
    organizationId: basis,
  };
  let sourceMapping = mapping;
  if (desired.source !== undefined) {
    const source = record(desired.source);
    environment = record(source.environment) as unknown as SchemaEnvironment;
    sourceMapping = parseMapping(source.mapping);
  }
  return {
    manifest: await createManifest(
      model,
      desired.data,
      environment,
      sourceMapping,
    ),
    mapping,
    purpose: desired.source === undefined ? "seed" : "transfer",
    basis,
    onExisting: desired.onExisting ?? "block",
    purge,
  };
}

export async function seedDesired(input: unknown): Promise<DesiredData> {
  const seed = await buildSeed(input);
  return {
    model: seed.model,
    mapping: seed.mapping,
    data: seed.data,
    basis: seed.namespaceFingerprint,
  };
}

export async function transferDesired(
  manifestInput: unknown,
  policy: unknown,
  mapping: DataverseMapping,
): Promise<DesiredData> {
  const manifest = await parseManifest(manifestInput);
  return {
    model: manifest.model,
    mapping,
    data: applyDataPolicy(manifest.model, manifest.data, policy),
    source: manifest.source,
    basis: await fingerprint(policy),
  };
}
