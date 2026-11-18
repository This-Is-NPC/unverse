import {
  type DataverseMapping,
  physicalEntity,
  record,
  SchemaError,
  type SchemaModel,
} from "./schema.js";
import { securityRolePresets } from "./security-role-presets.js";

export const depths = ["basic", "local", "deep", "global"] as const;
export type Depth = (typeof depths)[number];

export const tableAccesses = [
  "create",
  "read",
  "write",
  "delete",
  "append",
  "appendTo",
  "assign",
  "share",
] as const;
export type TableAccess = (typeof tableAccesses)[number];

export interface SecurityRole {
  readonly name: string;
  readonly preset?: string;
  readonly privileges?: Readonly<Record<string, Depth>>;
  readonly tables?: Readonly<
    Record<string, Readonly<Partial<Record<TableAccess, Depth>>>>
  >;
}

export interface SecurityRoles {
  readonly securityRoles?: readonly SecurityRole[];
}

export interface ObservedSecurityRoles {
  readonly roles: readonly {
    readonly name: string;
    readonly privileges: readonly {
      readonly name: string;
      readonly depth: Depth;
    }[];
  }[];
  readonly privileges: readonly string[];
}

export type SecurityRoleOperation =
  | { readonly kind: "create-security-role"; readonly role: string }
  | {
      readonly kind: "add-role-privileges";
      readonly role: string;
      readonly privileges: readonly {
        readonly name: string;
        readonly depth: Depth;
        readonly pending?: true;
      }[];
    };

export function isSecurityRoleOperation(operation: {
  readonly kind: string;
}): operation is SecurityRoleOperation {
  return (
    operation.kind === "create-security-role" ||
    operation.kind === "add-role-privileges"
  );
}

export function depthRank(depth: Depth): number {
  return depths.indexOf(depth);
}

export interface DeclaredPrivilege {
  readonly name: string;
  readonly depth: Depth;
  readonly table?: string;
}

// Preset, explicit and table privileges merged by name; the highest depth wins.
export function declaredPrivileges(
  mapping: DataverseMapping,
  model: SchemaModel | undefined,
  role: SecurityRole,
): {
  readonly privileges: readonly DeclaredPrivilege[];
  readonly unmodeled: readonly string[];
} {
  const merged = new Map<string, DeclaredPrivilege>();
  const add = (privilege: DeclaredPrivilege) => {
    const key = privilege.name.toLowerCase();
    const existing = merged.get(key);
    if (
      existing === undefined ||
      depthRank(privilege.depth) > depthRank(existing.depth)
    )
      merged.set(key, {
        ...privilege,
        ...(privilege.table === undefined && existing?.table !== undefined
          ? { table: existing.table }
          : {}),
      });
  };
  for (const [name, depth] of Object.entries(
    securityRolePresets[role.preset ?? ""] ?? {},
  ))
    add({ name, depth });
  for (const [name, depth] of Object.entries(role.privileges ?? {}))
    add({ name, depth });
  const unmodeled: string[] = [];
  for (const [table, accesses] of Object.entries(role.tables ?? {})) {
    const entity = model?.entities.find(
      (candidate) => candidate.name === table,
    );
    if (entity === undefined) {
      unmodeled.push(table);
      continue;
    }
    for (const [access, depth] of Object.entries(accesses))
      add({
        name: `prv${access[0]?.toUpperCase()}${access.slice(1)}${physicalEntity(mapping, entity)}`,
        depth,
        table,
      });
  }
  return {
    privileges: [...merged.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    unmodeled,
  };
}

export function parseSecurityRoles(
  mapping: Record<string, unknown>,
): SecurityRoles {
  if (mapping.securityRoles === undefined) return {};
  if (!Array.isArray(mapping.securityRoles))
    fail("securityRoles must be an array.");
  const roles = mapping.securityRoles.map(parseRole);
  if (
    new Set(roles.map((role) => role.name.toLowerCase())).size !== roles.length
  )
    fail("Security role names must be unique ignoring case.");
  return { securityRoles: roles.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function planSecurityRoles(
  mapping: DataverseMapping,
  model: SchemaModel,
  createdEntities: ReadonlySet<string>,
  observed: ObservedSecurityRoles | undefined,
): {
  readonly operations: readonly SecurityRoleOperation[];
  readonly blocked: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
} {
  const operations: SecurityRoleOperation[] = [];
  const blocked: { path: string; reason: string }[] = [];
  for (const role of mapping.securityRoles ?? []) {
    const existing = observed?.roles.find(
      (value) => value.name.toLowerCase() === role.name.toLowerCase(),
    );
    if (existing === undefined)
      operations.push({ kind: "create-security-role", role: role.name });
    const { privileges, unmodeled } = declaredPrivileges(mapping, model, role);
    for (const table of unmodeled)
      blocked.push({
        path: `securityRoles.${role.name}.tables.${table}`,
        reason:
          "The table is not a modeled entity; list external or system table privileges by full name under privileges.",
      });
    const additions: {
      name: string;
      depth: Depth;
      pending?: true;
    }[] = [];
    for (const privilege of privileges) {
      const have = existing?.privileges.find(
        (value) => value.name.toLowerCase() === privilege.name.toLowerCase(),
      );
      if (
        have !== undefined &&
        depthRank(have.depth) >= depthRank(privilege.depth)
      )
        continue;
      const known = observed?.privileges.some(
        (value) => value.toLowerCase() === privilege.name.toLowerCase(),
      );
      const pending =
        !known &&
        privilege.table !== undefined &&
        createdEntities.has(privilege.table);
      if (!known && !pending)
        blocked.push({
          path: `securityRoles.${role.name}.privileges.${privilege.name}`,
          reason: "The privilege does not exist in this environment.",
        });
      else
        additions.push({
          name: privilege.name,
          depth: privilege.depth,
          ...(pending ? { pending: true } : {}),
        });
    }
    if (additions.length !== 0)
      operations.push({
        kind: "add-role-privileges",
        role: role.name,
        privileges: additions,
      });
  }
  return { operations, blocked };
}

function parseRole(input: unknown): SecurityRole {
  const value = record(input);
  keys(value, ["name", "preset", "privileges", "tables"]);
  if (
    typeof value.name !== "string" ||
    value.name.trim() === "" ||
    value.name.length > 100
  )
    fail("A security role requires a name of at most 100 characters.");
  if (
    value.preset !== undefined &&
    (typeof value.preset !== "string" ||
      securityRolePresets[value.preset] === undefined)
  )
    fail(
      `A security role preset must be one of: ${Object.keys(securityRolePresets).join(", ")}.`,
    );
  const privileges =
    value.privileges === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(record(value.privileges)).map(([name, depth]) => {
            if (!/^prv[A-Za-z0-9_]+$/.test(name))
              fail("A privilege name must start with prv.");
            return [name, depthWord(depth)];
          }),
        );
  const tables =
    value.tables === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(record(value.tables)).map(([table, accesses]) => {
            if (!/^[a-z][a-z0-9_]{0,31}$/.test(table))
              fail("A table key must be a modeled entity name.");
            return [
              table,
              Object.fromEntries(
                Object.entries(record(accesses)).map(([access, depth]) => {
                  if (!tableAccesses.includes(access as TableAccess))
                    fail(
                      `A table access must be one of: ${tableAccesses.join(", ")}.`,
                    );
                  if (depthWord(depth) !== "global")
                    fail(
                      "Modeled tables are organization-owned, so their privileges must be global.",
                    );
                  return [access, depth as Depth];
                }),
              ),
            ];
          }),
        );
  return {
    name: value.name,
    ...(value.preset === undefined ? {} : { preset: value.preset as string }),
    ...(privileges === undefined ? {} : { privileges }),
    ...(tables === undefined ? {} : { tables }),
  };
}

function depthWord(value: unknown): Depth {
  if (!depths.includes(value as Depth))
    fail(`A depth must be one of: ${depths.join(", ")}.`);
  return value as Depth;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("Unknown security role property; semantics cannot be ignored.");
}

function fail(message: string): never {
  throw new SchemaError("invalid-input", message);
}
