import { DataverseError } from "./client.js";

export function endpoint(
  path: string,
  parameters: Readonly<Record<string, string>>,
): string {
  return `${path}?${new URLSearchParams(parameters).toString()}`;
}

export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function guid(value: string): string {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value))
    throw new DataverseError("invalid-input", "Expected a GUID.");
  return value.toLowerCase();
}

export function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value === "")
    throw new DataverseError(
      "service",
      `Dataverse response is missing ${field}.`,
    );
  return value;
}

export function nullableText(
  row: Record<string, unknown>,
  field: string,
): string | null {
  return typeof row[field] === "string" ? row[field] : null;
}

export function identifier(value: string): string {
  if (!/^[a-z_][a-z\d_]*$/i.test(value))
    throw new DataverseError(
      "invalid-input",
      "Expected a logical table or column identifier.",
    );
  return value;
}
