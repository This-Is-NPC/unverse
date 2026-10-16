import {
  type Column,
  record,
  SchemaError,
  type SchemaModel,
} from "./schema.js";

export type Scalar = string | number | boolean | null;
export type DataRow = Readonly<Record<string, Scalar>>;
export type Dataset = Readonly<Record<string, readonly DataRow[]>>;

export function normalizeDataset(model: SchemaModel, input: unknown): Dataset {
  const data = record(input);
  if (
    model.entities.some((entity) =>
      entity.columns.some((column) => column.externalReference !== undefined),
    )
  )
    throw new SchemaError(
      "unsupported",
      "Portable datasets cannot claim integrity for external references; model the related entity instead.",
    );
  if (
    Object.keys(data).some(
      (key) => !model.entities.some((entity) => entity.name === key),
    )
  )
    invalid("Unknown entity in dataset.");
  const normalized: Record<string, DataRow[]> = {};
  for (const entity of model.entities) {
    const rows = data[entity.name];
    if (!Array.isArray(rows))
      invalid(`Dataset requires rows for ${entity.name}.`);
    const ids = new Set<Scalar>();
    normalized[entity.name] = rows
      .map((inputRow) => {
        const row = record(inputRow);
        if (
          Object.keys(row).some(
            (key) => !entity.columns.some((column) => column.name === key),
          )
        )
          invalid(`Unknown column in ${entity.name}.`);
        const result: Record<string, Scalar> = {};
        for (const column of entity.columns) {
          if (!Object.hasOwn(row, column.name))
            invalid(`Missing ${entity.name}.${column.name}.`);
          result[column.name] = normalizeValue(column, row[column.name]);
        }
        const id = result[entity.primaryKey] ?? null;
        if (ids.has(id)) invalid(`Duplicate primary key in ${entity.name}.`);
        ids.add(id);
        return result;
      })
      .sort((a, b) =>
        String(a[entity.primaryKey]).localeCompare(
          String(b[entity.primaryKey]),
        ),
      );
  }
  for (const entity of model.entities)
    for (const column of entity.columns) {
      if (column.references === undefined) continue;
      const target = model.entities.find(
        (candidate) => candidate.name === column.references,
      );
      if (target === undefined) invalid("Unknown relationship target.");
      const targetIds = new Set(
        normalized[target.name]?.map((row) => row[target.primaryKey]),
      );
      for (const row of normalized[entity.name] ?? []) {
        if (row[column.name] !== null && !targetIds.has(row[column.name]))
          invalid(`Broken relationship ${entity.name}.${column.name}.`);
      }
    }
  return normalized;
}

export function normalizeValue(column: Column, input: unknown): Scalar {
  if (input === null) {
    if (!column.nullable) invalid(`Required value ${column.name} is null.`);
    return null;
  }
  switch (column.type) {
    case "text":
    case "multiline":
      if (typeof input === "string" && input.length <= (column.maxLength ?? 0))
        return input;
      break;
    case "boolean":
      if (typeof input === "boolean") return input;
      break;
    case "integer":
      if (
        typeof input === "number" &&
        Number.isInteger(input) &&
        input >= -2147483648 &&
        input <= 2147483647
      )
        return input;
      break;
    case "choice":
      if (
        typeof input === "number" &&
        column.options?.some((option) => option.value === input)
      )
        return input;
      break;
    case "uuid":
      if (
        typeof input === "string" &&
        /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(input)
      )
        return input.toLowerCase();
      break;
    case "decimal": {
      if (
        typeof input !== "string" ||
        input.length > 128 ||
        !/^-?\d+(?:\.\d+)?$/.test(input)
      )
        break;
      const negative = input.startsWith("-");
      const [whole = "0", fraction = ""] = input.replace(/^-/, "").split(".");
      const scale = column.scale ?? 0;
      if (fraction.slice(scale).replaceAll("0", "") !== "") break;
      const integer = whole.replace(/^0+(?=\d)/, "");
      const digits = fraction.slice(0, scale).padEnd(scale, "0");
      const coefficient = BigInt(`${integer}${digits}`);
      if (coefficient >= 10n ** BigInt(column.precision ?? 0)) break;
      return `${negative && coefficient !== 0n ? "-" : ""}${integer}${scale === 0 ? "" : `.${digits}`}`;
    }
    case "date": {
      if (
        typeof input !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
        input.startsWith("0000")
      )
        break;
      const date = new Date(`${input}T00:00:00.000Z`);
      if (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === input
      )
        return input;
      break;
    }
    case "instant": {
      if (
        typeof input !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          input,
        ) ||
        input.startsWith("0000")
      )
        break;
      const fractional = /\.(\d+)/.exec(input)?.[1] ?? "";
      normalizeValue(
        { name: column.name, type: "date", nullable: false },
        input.slice(0, 10),
      );
      if (
        Number(input.slice(11, 13)) > 23 ||
        Number(input.slice(14, 16)) > 59 ||
        Number(input.slice(17, 19)) > 59
      )
        break;
      if (fractional.replaceAll("0", "") !== "")
        throw new SchemaError(
          "unsupported",
          "Sub-second temporal precision is outside the verified portable subset.",
        );
      const date = new Date(input);
      if (Number.isFinite(date.getTime())) return date.toISOString();
      break;
    }
  }
  invalid(
    `Invalid ${column.type} value for ${column.name}; no lossy conversion is allowed.`,
  );
}

function invalid(message: string): never {
  throw new SchemaError("invalid-input", message);
}
