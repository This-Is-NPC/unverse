import { record, SchemaError } from "./schema.js";

export type TeamSelector =
  | { readonly id: string }
  | { readonly name: string }
  | { readonly environmentVariable: string };

export interface AccessTeam {
  readonly team: TeamSelector;
  readonly roles: readonly string[];
}

export interface AccessDocument {
  readonly accessVersion: 1;
  readonly teams: readonly AccessTeam[];
}

function fail(message: string): never {
  throw new SchemaError("invalid-input", message);
}

function nonEmpty(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "")
    fail(`${what} must be a non-empty string.`);
  return value as string;
}

function selector(input: unknown): TeamSelector {
  const value = record(input);
  const keys = Object.keys(value);
  const key = keys[0];
  if (
    keys.length !== 1 ||
    (key !== "id" && key !== "name" && key !== "environmentVariable")
  )
    fail(
      "A team selector has exactly one of id, name, or environmentVariable.",
    );
  const entry = nonEmpty(value[key], `The team ${key}`);
  return key === "id"
    ? { id: entry }
    : key === "name"
      ? { name: entry }
      : { environmentVariable: entry };
}

export function parseAccessDocument(input: unknown): AccessDocument {
  const value = record(input);
  for (const key of Object.keys(value))
    if (key !== "accessVersion" && key !== "teams")
      fail(`Unknown access property ${key}.`);
  if (value.accessVersion !== 1) fail("accessVersion must be 1.");
  if (!Array.isArray(value.teams) || value.teams.length === 0)
    fail("teams must be a non-empty array.");
  const teams = value.teams.map((entry: unknown): AccessTeam => {
    const team = record(entry);
    for (const key of Object.keys(team))
      if (key !== "team" && key !== "roles")
        fail(`Unknown team entry property ${key}.`);
    if (!Array.isArray(team.roles) || team.roles.length === 0)
      fail("Each team needs a non-empty roles array.");
    const roles = team.roles.map((role: unknown) =>
      nonEmpty(role, "A role name"),
    );
    if (new Set(roles).size !== roles.length)
      fail("A team lists a role name more than once.");
    return { team: selector(team.team), roles };
  });
  return { accessVersion: 1, teams };
}
