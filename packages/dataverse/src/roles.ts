import { type DataverseClient, DataverseError } from "./client.js";
import { endpoint, guid, literal, nullableText, text } from "./odata.js";

export interface UserSelector {
  readonly field: "id" | "email" | "domain" | "name";
  readonly value: string;
}

export interface RoleSource {
  readonly kind: "direct" | "team";
  readonly teamId?: string;
  readonly teamName?: string;
}

export interface AssignedRole {
  readonly id: string;
  readonly name: string;
  readonly businessUnitId: string | null;
  readonly sources: readonly RoleSource[];
}

export interface UserRoles {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly disabled: boolean;
    readonly businessUnitId: string | null;
  };
  readonly roles: readonly AssignedRole[];
}

export async function userRoles(
  client: DataverseClient,
  selector: UserSelector,
): Promise<UserRoles> {
  const filter =
    selector.field === "id"
      ? `systemuserid eq ${guid(selector.value)}`
      : `${selector.field === "email" ? "internalemailaddress" : selector.field === "name" ? "fullname" : "domainname"} eq ${literal(selector.value)}`;
  const users = await client.collect(
    endpoint("systemusers", {
      $select: "systemuserid,fullname,isdisabled,_businessunitid_value",
      $filter: filter,
    }),
  );
  if (users.rows.length !== 1)
    throw new DataverseError(
      "invalid-input",
      users.rows.length === 0
        ? "No user matched the selector."
        : "The user selector is ambiguous; use --user-id.",
    );
  const user = users.rows[0];
  if (user === undefined)
    throw new DataverseError("service", "The user response is missing.");
  const id = guid(text(user, "systemuserid"));
  if (typeof user.isdisabled !== "boolean")
    throw new DataverseError("service", "User response is missing isdisabled.");
  const roles = new Map<string, AssignedRole>();
  const columns = "roleid,name,_businessunitid_value";
  const direct = await client.collect(
    endpoint(`systemusers(${id})/systemuserroles_association`, {
      $select: columns,
    }),
  );
  for (const role of direct.rows) addRole(roles, role, { kind: "direct" });
  const teams = await client.collect(
    endpoint(`systemusers(${id})/teammembership_association`, {
      $select: "teamid,name",
    }),
  );
  for (const team of teams.rows) {
    const teamId = guid(text(team, "teamid"));
    const assigned = await client.collect(
      endpoint(`teams(${teamId})/teamroles_association`, { $select: columns }),
    );
    for (const role of assigned.rows)
      addRole(roles, role, {
        kind: "team",
        teamId,
        teamName: text(team, "name"),
      });
  }
  return {
    user: {
      id,
      name: text(user, "fullname"),
      disabled: user.isdisabled,
      businessUnitId: nullableText(user, "_businessunitid_value"),
    },
    roles: [...roles.values()],
  };
}

export async function resolveRole(
  client: DataverseClient,
  selector: { readonly id?: string; readonly name?: string },
): Promise<string> {
  if (selector.id !== undefined) return guid(selector.id);
  if (selector.name === undefined || selector.name === "")
    throw new DataverseError("invalid-input", "A role selector is required.");
  const matches = await client.collect(
    endpoint("roles", {
      $select: "roleid,name",
      $filter: `name eq ${literal(selector.name)}`,
    }),
  );
  if (matches.rows.length !== 1)
    throw new DataverseError(
      "invalid-input",
      "The role name is missing or ambiguous; use --role-id.",
    );
  return guid(text(matches.rows[0] ?? {}, "roleid"));
}

function addRole(
  roles: Map<string, AssignedRole>,
  row: Record<string, unknown>,
  source: RoleSource,
): void {
  const id = guid(text(row, "roleid"));
  const previous = roles.get(id);
  const sources = [...(previous?.sources ?? [])];
  if (
    !sources.some(
      (candidate) =>
        candidate.kind === source.kind && candidate.teamId === source.teamId,
    )
  )
    sources.push(source);
  roles.set(id, {
    id,
    name: text(row, "name"),
    businessUnitId: nullableText(row, "_businessunitid_value"),
    sources,
  });
}
