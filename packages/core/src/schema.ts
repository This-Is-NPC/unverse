import { parseSecurityRoles, type SecurityRoles } from "./security-roles.js";
import {
  parseSolutionComponents,
  type SolutionComponents,
} from "./solution-components.js";

export type ColumnType =
  | "text"
  | "multiline"
  | "choice"
  | "boolean"
  | "integer"
  | "decimal"
  | "uuid"
  | "date"
  | "instant";

export interface Column {
  readonly name: string;
  readonly type: ColumnType;
  readonly nullable: boolean;
  readonly maxLength?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly semantics?: "utc";
  readonly resolution?: "second";
  readonly references?: string;
  readonly externalReference?: {
    readonly table: string;
    readonly primaryKey: string;
  };
  readonly options?: readonly {
    readonly value: number;
    readonly label: string;
  }[];
}

export interface Key {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface Entity {
  readonly name: string;
  readonly primaryKey: string;
  readonly primaryName: string;
  readonly columns: readonly Column[];
  readonly keys?: readonly Key[];
}

export interface SchemaModel {
  readonly modelVersion: 1;
  readonly entities: readonly Entity[];
}

export interface DataverseMapping extends SolutionComponents, SecurityRoles {
  readonly prefix: string;
  readonly solution: string;
}

export class SchemaError extends Error {
  constructor(
    readonly code: "invalid-input" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "SchemaError";
  }
}

export function parseModel(input: unknown): SchemaModel {
  const model = record(input);
  keys(model, ["modelVersion", "entities"]);
  if (
    model.modelVersion !== 1 ||
    !Array.isArray(model.entities) ||
    model.entities.length === 0
  )
    fail("Expected modelVersion 1 and a non-empty entities array.");
  const entities: Entity[] = model.entities
    .map((value) => {
      const entity = record(value);
      keys(entity, ["name", "primaryKey", "primaryName", "columns", "keys"]);
      if (!Array.isArray(entity.columns) || entity.columns.length === 0)
        fail("An entity requires columns.");
      const columns = entity.columns.map(parseColumn).sort(byName);
      unique(columns.map((column) => column.name));
      const primaryKey = name(entity.primaryKey);
      const primaryName = name(entity.primaryName);
      const key = columns.find((column) => column.name === primaryKey);
      const label = columns.find((column) => column.name === primaryName);
      if (
        key?.type !== "uuid" ||
        key.nullable ||
        key.references !== undefined ||
        key.externalReference !== undefined
      )
        fail("The primary key must be a required UUID without a reference.");
      if (
        label?.type !== "text" ||
        label.nullable ||
        primaryKey === primaryName
      )
        fail("The primary name must be required text.");
      const alternateKeys =
        entity.keys === undefined ? [] : parseKeys(entity.keys, columns);
      return {
        name: name(entity.name),
        primaryKey,
        primaryName,
        columns,
        ...(alternateKeys.length === 0 ? {} : { keys: alternateKeys }),
      };
    })
    .sort(byName);
  unique(entities.map((entity) => entity.name));
  for (const entity of entities)
    for (const column of entity.columns) {
      if (
        column.references !== undefined &&
        !entities.some((target) => target.name === column.references)
      )
        fail("A reference must name an entity in the model.");
    }
  return { modelVersion: 1, entities };
}

const keyTypes: readonly ColumnType[] = [
  "text",
  "integer",
  "decimal",
  "date",
  "instant",
  "choice",
];

function parseKeys(input: unknown, columns: readonly Column[]): Key[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 10)
    fail("An entity declares between one and ten alternate keys.");
  const parsed = input.map((value): Key => {
    const key = record(value);
    keys(key, ["name", "columns"]);
    if (
      !Array.isArray(key.columns) ||
      key.columns.length === 0 ||
      key.columns.length > 16
    )
      fail("An alternate key requires between one and sixteen columns.");
    const names = key.columns.map(name).sort();
    unique(names);
    for (const columnName of names) {
      const column = columns.find((candidate) => candidate.name === columnName);
      if (column === undefined)
        fail("An alternate key column must exist on its entity.");
      if (column.nullable) fail("An alternate key column must be required.");
      if (
        !keyTypes.includes(column.type) &&
        !(column.type === "uuid" && column.references !== undefined) &&
        !(column.type === "uuid" && column.externalReference !== undefined)
      )
        throw new SchemaError(
          "unsupported",
          "Dataverse alternate keys support text, integer, decimal, date, instant, choice, and lookup columns.",
        );
    }
    return { name: name(key.name), columns: names };
  });
  unique(parsed.map((key) => key.name));
  if (
    new Set(parsed.map((key) => key.columns.join(","))).size !== parsed.length
  )
    fail("Two alternate keys cannot use the same columns.");
  return parsed.sort(byName);
}

export function parseMapping(input: unknown): DataverseMapping {
  const mapping = record(input);
  keys(mapping, [
    "prefix",
    "solution",
    "environmentVariables",
    "connectionReferences",
    "securityRoles",
  ]);
  if (
    typeof mapping.prefix !== "string" ||
    !/^[a-z][a-z0-9]{1,7}$/.test(mapping.prefix)
  )
    fail(
      "Publisher prefix must contain 2–8 lowercase letters or digits, starting with a letter.",
    );
  if (
    typeof mapping.solution !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(mapping.solution)
  )
    fail("A solution unique name is required.");
  return {
    prefix: mapping.prefix,
    solution: mapping.solution,
    ...parseSolutionComponents(mapping, mapping.prefix),
    ...parseSecurityRoles(mapping),
  };
}

function parseColumn(input: unknown): Column {
  const column = record(input);
  keys(column, [
    "name",
    "type",
    "nullable",
    "maxLength",
    "precision",
    "scale",
    "semantics",
    "resolution",
    "references",
    "externalReference",
    "options",
  ]);
  if (typeof column.nullable !== "boolean")
    fail("Column nullability must be explicit.");
  if (
    ![
      "text",
      "multiline",
      "choice",
      "boolean",
      "integer",
      "decimal",
      "uuid",
      "date",
      "instant",
    ].includes(String(column.type))
  )
    throw new SchemaError(
      "unsupported",
      "Unsupported column type; money, files, floats, and polymorphic lookups need explicit mappings.",
    );
  const base = {
    name: name(column.name),
    type: column.type as ColumnType,
    nullable: column.nullable,
  };
  if (base.type === "text" || base.type === "multiline") {
    positive(
      column.maxLength,
      base.type === "text" ? 4000 : 1048576,
      "Text requires a supported explicit maxLength.",
    );
  } else if (column.maxLength !== undefined)
    fail("maxLength applies only to text or multiline.");
  if (base.type === "decimal") {
    positive(
      column.precision,
      38,
      "Decimal precision must be between 1 and 38.",
    );
    if (
      !Number.isInteger(column.scale) ||
      Number(column.scale) < 0 ||
      Number(column.scale) > Number(column.precision)
    )
      fail("Decimal scale must be between zero and precision.");
  } else if (column.precision !== undefined || column.scale !== undefined)
    fail("Precision and scale apply only to decimal.");
  if (base.type === "instant") {
    if (column.semantics !== "utc" || column.resolution === undefined)
      fail(
        "An instant must explicitly declare utc semantics and second resolution.",
      );
    if (column.resolution !== "second")
      throw new SchemaError(
        "unsupported",
        "Only explicitly declared UTC second resolution is in the verified Dataverse subset.",
      );
  } else if (column.semantics !== undefined)
    fail("UTC semantics apply only to instants.");
  if (base.type !== "instant" && column.resolution !== undefined)
    fail("Temporal resolution applies only to instants.");
  if (column.references !== undefined && base.type !== "uuid")
    fail("Only UUID columns can reference another entity.");
  let externalReference: Column["externalReference"];
  if (column.externalReference !== undefined) {
    if (base.type !== "uuid" || column.references !== undefined)
      fail(
        "External references require UUID and cannot also reference a modeled entity.",
      );
    const external = record(column.externalReference);
    keys(external, ["table", "primaryKey"]);
    externalReference = {
      table: name(external.table),
      primaryKey: name(external.primaryKey),
    };
  }
  let options: Column["options"];
  if (base.type === "choice") {
    if (!Array.isArray(column.options) || !column.options.length)
      fail("A choice requires explicit local options.");
    options = column.options
      .map((input) => {
        const option = record(input);
        keys(option, ["value", "label"]);
        if (
          !Number.isInteger(option.value) ||
          Number(option.value) < 0 ||
          Number(option.value) > 2147483647 ||
          typeof option.label !== "string" ||
          option.label.trim() === "" ||
          option.label.length > 100
        )
          fail(
            "A choice requires non-negative int32 values and non-empty labels of at most 100 characters.",
          );
        return { value: Number(option.value), label: option.label };
      })
      .sort((a, b) => a.value - b.value);
    unique(options.map((option) => String(option.value)));
    unique(options.map((option) => option.label));
  } else if (column.options !== undefined)
    fail("Options apply only to choices.");
  return {
    ...base,
    ...(["text", "multiline"].includes(base.type)
      ? { maxLength: Number(column.maxLength) }
      : {}),
    ...(options === undefined ? {} : { options }),
    ...(externalReference === undefined ? {} : { externalReference }),
    ...(base.type === "decimal"
      ? { precision: Number(column.precision), scale: Number(column.scale) }
      : {}),
    ...(base.type === "instant"
      ? { semantics: "utc" as const, resolution: "second" as const }
      : {}),
    ...(column.references === undefined
      ? {}
      : { references: name(column.references) }),
  };
}

export function physicalEntity(
  mapping: DataverseMapping,
  entity: Entity,
): string {
  return `${mapping.prefix}_${entity.name}`;
}

export function physicalKey(mapping: DataverseMapping, key: Key): string {
  return `${mapping.prefix}_${key.name}`;
}

export function physicalColumn(
  mapping: DataverseMapping,
  entity: Entity,
  column: Column,
): string {
  return column.name === entity.primaryKey
    ? `${physicalEntity(mapping, entity)}id`
    : `${mapping.prefix}_${column.name}`;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("Expected an object.");
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("Unknown model property; semantics cannot be ignored.");
}

function name(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(value))
    fail(
      "Logical names must be lowercase identifiers of at most 32 characters.",
    );
  return value;
}

function positive(value: unknown, maximum: number, message: string): void {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum)
    fail(message);
}

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail("Names must be unique.");
}

function byName(
  a: { readonly name: string },
  b: { readonly name: string },
): number {
  return a.name.localeCompare(b.name);
}

function fail(message: string): never {
  throw new SchemaError("invalid-input", message);
}
