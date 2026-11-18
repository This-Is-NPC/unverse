import { record, SchemaError } from "./schema.js";

export interface EnvironmentVariableDefinition {
  readonly schemaName: string;
  readonly displayName: string;
  readonly type: "text";
  readonly defaultValue?: string;
}

export interface ConnectionReference {
  readonly displayName: string;
  readonly connector: string;
}

export interface SolutionComponents {
  readonly environmentVariables?: readonly EnvironmentVariableDefinition[];
  readonly connectionReferences?: readonly ConnectionReference[];
}

export interface ObservedEnvironmentVariable {
  readonly schemaName: string;
  readonly displayName: string;
  readonly providerType: number;
  readonly defaultMatches: boolean;
}

export interface ObservedConnectionReference {
  readonly logicalName: string;
  readonly connectorId: string;
}

export interface ObservedSolutionComponents {
  readonly environmentVariables: readonly ObservedEnvironmentVariable[];
  readonly connectionReferences: readonly ObservedConnectionReference[];
}

export type SolutionComponentOperation =
  | {
      readonly kind: "create-environment-variable";
      readonly schemaName: string;
    }
  | {
      readonly kind: "create-connection-reference";
      readonly logicalName: string;
    };

export function isSolutionComponentOperation(operation: {
  readonly kind: string;
}): operation is SolutionComponentOperation {
  return (
    operation.kind === "create-environment-variable" ||
    operation.kind === "create-connection-reference"
  );
}

export const textVariableType = 100000000;

export function connectionReferenceName(
  prefix: string,
  displayName: string,
): string {
  return `${prefix}_${displayName.replace(/[-\s]/g, "")}`;
}

export function connectorId(connector: string): string {
  return `/providers/Microsoft.PowerApps/apis/${connector}`;
}

export function parseSolutionComponents(
  mapping: Record<string, unknown>,
  prefix: string,
): SolutionComponents {
  const environmentVariables = optionalList(
    mapping.environmentVariables,
    "environmentVariables",
  )?.map((value) => parseVariable(value, prefix));
  const connectionReferences = optionalList(
    mapping.connectionReferences,
    "connectionReferences",
  )?.map((value) => parseReference(value, prefix));
  if (environmentVariables !== undefined)
    unique(
      environmentVariables.map((variable) => variable.schemaName),
      "Environment variable schema names must be unique.",
    );
  if (connectionReferences !== undefined)
    unique(
      connectionReferences.map((reference) =>
        connectionReferenceName(prefix, reference.displayName),
      ),
      "Connection reference logical names must be unique.",
    );
  return {
    ...(environmentVariables === undefined
      ? {}
      : {
          environmentVariables: environmentVariables.sort((a, b) =>
            a.schemaName.localeCompare(b.schemaName),
          ),
        }),
    ...(connectionReferences === undefined
      ? {}
      : {
          connectionReferences: connectionReferences.sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          ),
        }),
  };
}

export function planSolutionComponents(
  prefix: string,
  components: SolutionComponents,
  observed: ObservedSolutionComponents | undefined,
): {
  readonly operations: readonly SolutionComponentOperation[];
  readonly blocked: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
} {
  const operations: SolutionComponentOperation[] = [];
  const blocked: { path: string; reason: string }[] = [];
  for (const variable of components.environmentVariables ?? []) {
    const existing = observed?.environmentVariables.find(
      (value) =>
        value.schemaName.toLowerCase() === variable.schemaName.toLowerCase(),
    );
    if (existing === undefined)
      operations.push({
        kind: "create-environment-variable",
        schemaName: variable.schemaName,
      });
    else if (
      existing.displayName !== variable.displayName ||
      existing.providerType !== textVariableType ||
      !existing.defaultMatches
    )
      blocked.push({
        path: `environmentVariables.${variable.schemaName}`,
        reason:
          "Existing environment variable definition differs in display name, type or default value; definitions are never modified.",
      });
  }
  for (const reference of components.connectionReferences ?? []) {
    const logicalName = connectionReferenceName(prefix, reference.displayName);
    const existing = observed?.connectionReferences.find(
      (value) => value.logicalName.toLowerCase() === logicalName.toLowerCase(),
    );
    if (existing === undefined)
      operations.push({ kind: "create-connection-reference", logicalName });
    else if (existing.connectorId !== connectorId(reference.connector))
      blocked.push({
        path: `connectionReferences.${logicalName}`,
        reason:
          "Existing connection reference uses a different connector; references are never modified.",
      });
  }
  return { operations, blocked };
}

function parseVariable(
  input: unknown,
  prefix: string,
): EnvironmentVariableDefinition {
  const value = record(input);
  keys(value, ["schemaName", "displayName", "type", "defaultValue"]);
  if (
    typeof value.schemaName !== "string" ||
    !value.schemaName.startsWith(`${prefix}_`) ||
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(value.schemaName) ||
    value.schemaName.length === prefix.length + 1
  )
    fail(
      "An environment variable schemaName must start with the mapping prefix and an underscore.",
    );
  if (typeof value.displayName !== "string" || value.displayName.trim() === "")
    fail("An environment variable requires a display name.");
  if (value.type !== "text")
    throw new SchemaError(
      "unsupported",
      "Only text environment variables are supported; other types are not provisioned.",
    );
  if (
    value.defaultValue !== undefined &&
    typeof value.defaultValue !== "string"
  )
    fail("An environment variable default value must be text.");
  return {
    schemaName: value.schemaName,
    displayName: value.displayName,
    type: "text",
    ...(value.defaultValue === undefined
      ? {}
      : { defaultValue: value.defaultValue }),
  };
}

function parseReference(input: unknown, prefix: string): ConnectionReference {
  const value = record(input);
  keys(value, ["displayName", "connector"]);
  if (
    typeof value.displayName !== "string" ||
    !/^[A-Za-z0-9_]+$/.test(
      connectionReferenceName(prefix, value.displayName).slice(
        prefix.length + 1,
      ),
    )
  )
    fail(
      "A connection reference display name must derive a non-empty logical name of letters, digits and underscores once hyphens and whitespace are removed.",
    );
  if (
    typeof value.connector !== "string" ||
    !/^[A-Za-z0-9_.-]+$/.test(value.connector)
  )
    fail("A connection reference requires a connector API name.");
  return { displayName: value.displayName, connector: value.connector };
}

function optionalList(
  value: unknown,
  property: string,
): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`${property} must be an array.`);
  return value;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("Unknown solution component property; semantics cannot be ignored.");
}

function unique(values: readonly string[], message: string): void {
  if (
    new Set(values.map((value) => value.toLowerCase())).size !== values.length
  )
    fail(message);
}

function fail(message: string): never {
  throw new SchemaError("invalid-input", message);
}
