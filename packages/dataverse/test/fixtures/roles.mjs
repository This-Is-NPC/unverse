import { DataverseClient } from "../../dist/index.js";

export const userId = "00000000-0000-0000-0000-000000000001";
export const roleId = "00000000-0000-0000-0000-000000000002";
export const teamId = "00000000-0000-0000-0000-000000000003";
export const otherRoleId = "00000000-0000-0000-0000-000000000004";
export const role = {
  roleid: roleId,
  name: "Reader",
  _businessunitid_value: "unit",
};

export function fixture(options = {}) {
  const calls = [];
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "fixture-token" },
    {
      get: async (value) => {
        calls.push(value);
        const url = new URL(value);
        const path = url.pathname.split("/api/data/v9.2/")[1];
        let rows;
        if (path === "WhoAmI")
          return response({
            OrganizationId: "org",
            UserId: "app",
            BusinessUnitId: "unit",
          });
        if (path === "systemusers")
          rows = options.users ?? [
            {
              systemuserid: userId,
              fullname: "Synthetic User",
              isdisabled: options.disabled ?? false,
            },
          ];
        else if (path === `systemusers(${userId})/systemuserroles_association`)
          rows = options.direct ?? [role];
        else if (path === `systemusers(${userId})/teammembership_association`)
          rows = [{ teamid: teamId, name: "Synthetic Team" }];
        else if (path === `teams(${teamId})/teamroles_association`) {
          if (options.denied)
            return {
              status: 403,
              headers: {},
              body: JSON.stringify({ error: { message: "Denied team roles" } }),
            };
          rows = options.team ?? [role];
        } else if (path === "roles") rows = options.roleMatches ?? [role];
        else throw new Error(`Unmatched fixture request: ${value}`);
        return response({ value: rows });
      },
    },
    { now: () => 0, wait: async () => {} },
  );
  return { client, calls };
}

function response(body) {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}
