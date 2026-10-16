import {
  fingerprint,
  parseMapping,
  parseModel,
  record,
  SchemaError,
} from "./schema.js";
import { type Dataset, normalizeDataset } from "./values.js";

export async function buildSeed(input: unknown) {
  const spec = record(input);
  if (
    spec.seedVersion !== 1 ||
    typeof spec.seed !== "string" ||
    !spec.seed ||
    Object.keys(spec).some(
      (key) =>
        !["seedVersion", "seed", "model", "mapping", "rows"].includes(key),
    )
  )
    throw new SchemaError(
      "invalid-input",
      "Expected seedVersion 1, a non-empty seed namespace, model, mapping, and keyed rows.",
    );
  const model = parseModel(spec.model);
  const mapping = parseMapping(spec.mapping);
  const source = record(spec.rows);
  if (
    Object.keys(source).some(
      (name) => !model.entities.some((entity) => entity.name === name),
    )
  )
    throw new SchemaError("invalid-input", "Seed has unknown entities.");
  const ids = new Map<string, string>();
  for (const entity of model.entities) {
    const rows = source[entity.name];
    if (!Array.isArray(rows))
      throw new SchemaError(
        "invalid-input",
        "Seed requires rows for every modeled entity.",
      );
    for (const input of rows) {
      const row = record(input);
      if (
        typeof row.key !== "string" ||
        !row.key ||
        row.key.length > 128 ||
        Object.keys(row).some((key) => !["key", "values"].includes(key))
      )
        throw new SchemaError(
          "invalid-input",
          "Seed rows require a unique non-empty key and values.",
        );
      const key = JSON.stringify([entity.name, row.key]);
      if (ids.has(key))
        throw new SchemaError("invalid-input", "Duplicate seed row key.");
      const hash = await fingerprint([spec.seed, entity.name, row.key]);
      ids.set(
        key,
        `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${((Number.parseInt(hash[16] ?? "0", 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
      );
    }
  }
  const data: Record<string, readonly Record<string, unknown>[]> = {};
  for (const entity of model.entities) {
    const rows = source[entity.name] as readonly unknown[];
    data[entity.name] = rows.map((input) => {
      const row = record(input);
      const values = record(row.values);
      if (Object.hasOwn(values, entity.primaryKey))
        throw new SchemaError(
          "invalid-input",
          "Seed IDs are derived from the namespace, entity, and key, not supplied values.",
        );
      const output: Record<string, unknown> = {
        ...values,
        [entity.primaryKey]: ids.get(JSON.stringify([entity.name, row.key])),
      };
      for (const column of entity.columns)
        if (column.references !== undefined && values[column.name] !== null) {
          const reference = record(values[column.name]);
          if (
            Object.keys(reference).length !== 1 ||
            typeof reference.key !== "string"
          )
            throw new SchemaError(
              "invalid-input",
              "Seed relationships require {key: target-row-key} or null.",
            );
          const id = ids.get(
            JSON.stringify([column.references, reference.key]),
          );
          if (id === undefined)
            throw new SchemaError(
              "invalid-input",
              "Seed relationship key was not found.",
            );
          output[column.name] = id;
        }
      return output;
    });
  }
  return {
    model,
    mapping,
    data: normalizeDataset(model, data),
    namespaceFingerprint: await fingerprint(spec.seed),
  };
}

export function applyDataPolicy(
  model: import("./schema.js").SchemaModel,
  data: Dataset,
  input: unknown,
): Dataset {
  const policy = record(input);
  if (
    policy.policyVersion !== 1 ||
    Object.keys(policy).some(
      (key) => !["policyVersion", "fields"].includes(key),
    )
  )
    throw new SchemaError(
      "invalid-input",
      "A reviewed policyVersion 1 field policy is required.",
    );
  const fields = record(policy.fields);
  const required = model.entities.flatMap((entity) =>
    entity.columns
      .filter(
        (column) =>
          column.name !== entity.primaryKey && column.references === undefined,
      )
      .map((column) => `${entity.name}.${column.name}`),
  );
  if (
    Object.keys(fields).length !== required.length ||
    required.some((path) => !Object.hasOwn(fields, path))
  )
    throw new SchemaError(
      "invalid-input",
      "Every non-identity, non-relationship field requires exactly one copy or constant policy.",
    );
  const rules = new Map<string, Record<string, unknown>>();
  for (const path of required) {
    const rule = record(fields[path]);
    if (
      rule.action === "copy"
        ? Object.keys(rule).length !== 1
        : rule.action !== "constant" ||
          !Object.hasOwn(rule, "value") ||
          Object.keys(rule).length !== 2
    )
      throw new SchemaError(
        "invalid-input",
        "Policy rules are {action: copy} or {action: constant, value: ...}.",
      );
    rules.set(path, rule);
  }
  const result = Object.fromEntries(
    model.entities.map((entity) => [
      entity.name,
      (data[entity.name] ?? []).map((row) =>
        Object.fromEntries(
          entity.columns.map((column) => {
            const rule = rules.get(`${entity.name}.${column.name}`);
            return [
              column.name,
              rule?.action === "constant" ? rule.value : row[column.name],
            ];
          }),
        ),
      ),
    ]),
  );
  return normalizeDataset(model, result);
}
