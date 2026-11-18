import {
  type DataverseMapping,
  type Depth,
  declaredPrivileges,
  depths,
  type ObservedSecurityRoles,
  type SchemaModel,
  type SecurityRoleOperation,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { endpoint, guid, literal, text } from "./odata.js";

const namesPerRequest = 25;

export async function inspectSecurityRoles(
  client: DataverseClient,
  mapping: DataverseMapping,
  model: SchemaModel | undefined,
): Promise<ObservedSecurityRoles | undefined> {
  if (mapping.securityRoles === undefined) return undefined;
  const root = await rootBusinessUnit(client);
  const known = await privilegeIds(
    client,
    mapping.securityRoles.flatMap((role) =>
      declaredPrivileges(mapping, model, role).privileges.map(
        (privilege) => privilege.name,
      ),
    ),
  );
  const byId = new Map(
    [...known.values()].map(({ id, name }) => [id, name] as const),
  );
  const roles = [];
  for (const role of mapping.securityRoles) {
    const id = await roleId(client, role.name, root);
    if (id === undefined) continue;
    const { rows } = await client.collect(
      endpoint("roleprivilegescollection", {
        $select: "privilegeid,privilegedepthmask",
        $filter: `roleid eq ${id}`,
      }),
    );
    roles.push({
      name: role.name,
      privileges: rows.flatMap((row) => {
        const name = byId.get(guid(text(row, "privilegeid")));
        const depth = depthOf(row.privilegedepthmask);
        return name === undefined || depth === undefined
          ? []
          : [{ name, depth }];
      }),
    });
  }
  return {
    roles,
    privileges: [...known.values()].map(({ name }) => name).sort(),
  };
}

export async function provisionSecurityRoles(
  client: DataverseClient,
  mapping: DataverseMapping,
  operations: readonly SecurityRoleOperation[],
  headers: Readonly<Record<string, string>>,
  waitFor: (subject: string, probe: () => Promise<unknown>) => Promise<void>,
): Promise<void> {
  if (operations.length === 0) return;
  const root = await rootBusinessUnit(client);
  for (const operation of operations) {
    if (!mapping.securityRoles?.some((role) => role.name === operation.role))
      throw new DataverseError(
        "invalid-input",
        "Plan security role is missing.",
      );
    if (operation.kind !== "create-security-role") continue;
    await client.write(
      "POST",
      "roles",
      {
        name: operation.role,
        "businessunitid@odata.bind": `/businessunits(${root})`,
      },
      headers,
    );
    await waitFor(`security role ${operation.role}`, () =>
      roleId(client, operation.role, root),
    );
  }
  for (const operation of operations) {
    if (operation.kind !== "add-role-privileges") continue;
    const id = await roleId(client, operation.role, root);
    if (id === undefined)
      throw new DataverseError(
        "service",
        `Security role ${operation.role} does not exist in the root business unit.`,
      );
    const names = operation.privileges.map((privilege) => privilege.name);
    const resolve = async () => {
      const ids = await privilegeIds(client, names);
      return ids.size === names.length ? ids : undefined;
    };
    let ids = await resolve();
    if (
      ids === undefined &&
      operation.privileges.some((privilege) => privilege.pending === true)
    )
      await waitFor(`privileges of ${operation.role}`, async () => {
        ids = await resolve();
        return ids;
      });
    if (ids === undefined)
      throw new DataverseError(
        "service",
        `Privileges of ${operation.role} do not exist in this environment.`,
      );
    const resolved = ids;
    await client.write(
      "POST",
      `roles(${id})/Microsoft.Dynamics.CRM.AddPrivilegesRole`,
      {
        Privileges: operation.privileges.map((privilege) => ({
          PrivilegeId: resolved.get(privilege.name.toLowerCase())?.id,
          PrivilegeName: privilege.name,
          Depth: depthName(privilege.depth),
          BusinessUnitId: root,
        })),
      },
      headers,
    );
  }
}

async function rootBusinessUnit(client: DataverseClient): Promise<string> {
  const { rows } = await client.collect(
    endpoint("businessunits", {
      $select: "businessunitid",
      $filter: "_parentbusinessunitid_value eq null",
    }),
  );
  if (rows.length !== 1)
    throw new DataverseError(
      "service",
      "The root business unit does not resolve uniquely.",
    );
  return guid(text(rows[0] ?? {}, "businessunitid"));
}

async function roleId(
  client: DataverseClient,
  name: string,
  root: string,
): Promise<string | undefined> {
  const { rows } = await client.collect(
    endpoint("roles", {
      $select: "roleid",
      $filter: `name eq ${literal(name)} and _businessunitid_value eq ${root}`,
    }),
  );
  if (rows.length > 1)
    throw new DataverseError(
      "service",
      `Several security roles named ${name} exist in the root business unit.`,
    );
  return rows[0] === undefined ? undefined : guid(text(rows[0], "roleid"));
}

async function privilegeIds(
  client: DataverseClient,
  names: readonly string[],
): Promise<Map<string, { readonly id: string; readonly name: string }>> {
  const unique = [...new Set(names)];
  const found = new Map<string, { id: string; name: string }>();
  for (let start = 0; start < unique.length; start += namesPerRequest) {
    const { rows } = await client.collect(
      endpoint("privileges", {
        $select: "privilegeid,name",
        $filter: unique
          .slice(start, start + namesPerRequest)
          .map((name) => `name eq ${literal(name)}`)
          .join(" or "),
      }),
    );
    for (const row of rows) {
      const name = text(row, "name");
      found.set(name.toLowerCase(), {
        id: guid(text(row, "privilegeid")),
        name,
      });
    }
  }
  return found;
}

// Role privilege depth masks: 1 basic, 2 local, 4 deep, 8 global.
function depthOf(mask: unknown): Depth | undefined {
  if (typeof mask !== "number") return undefined;
  return depths.findLast((_, index) => (mask & (1 << index)) !== 0);
}

function depthName(depth: Depth): string {
  return `${depth.slice(0, 1).toUpperCase()}${depth.slice(1)}`;
}
