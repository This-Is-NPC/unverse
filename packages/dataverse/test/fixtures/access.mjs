import { DataverseClient } from "../../dist/index.js";

const id = (suffix) => `00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;
export const rootUnit = id("a1");
export const childUnit = id("a2");
export const childTeam = id("b1");
export const rootTeam = id("b2");
export const twinTeam = id("b3");
export const rootRole = id("c1");
export const childRole = id("c2");
export const rootOnlyRole = id("c3");
export const duplicateRoles = [id("c4"), id("c5")];
export const environment = {
  name: "dev",
  url: "https://dev.crm.dynamics.com",
  organizationId: "organization",
};

const teams = [
  { teamid: childTeam, name: "Child Team", _businessunitid_value: childUnit },
  { teamid: rootTeam, name: "Root Team", _businessunitid_value: rootUnit },
  { teamid: twinTeam, name: "Twin", _businessunitid_value: rootUnit },
  { teamid: id("b4"), name: "Twin", _businessunitid_value: rootUnit },
];

const roles = [
  {
    roleid: rootRole,
    name: "sr-Example-Users",
    _businessunitid_value: rootUnit,
  },
  {
    roleid: childRole,
    name: "sr-Example-Users",
    _businessunitid_value: childUnit,
  },
  {
    roleid: rootOnlyRole,
    name: "sr-Root-Only",
    _businessunitid_value: rootUnit,
  },
  {
    roleid: duplicateRoles[0],
    name: "sr-Duplicate",
    _businessunitid_value: childUnit,
  },
  {
    roleid: duplicateRoles[1],
    name: "sr-Duplicate",
    _businessunitid_value: childUnit,
  },
];

export const variableTeam = "uv_AccessTeam";
export const variableDefaultTeam = "uv_DefaultTeam";
export const variableUnset = "uv_UnsetTeam";
export const variableSecret = "uv_SecretTeam";
const definitions = [
  {
    schema: variableTeam,
    type: 100000000,
    value: childTeam,
    fallback: rootTeam,
  },
  {
    schema: variableDefaultTeam,
    type: 100000000,
    value: null,
    fallback: rootTeam,
  },
  { schema: variableUnset, type: 100000000, value: null, fallback: null },
  { schema: variableSecret, type: 100000005, value: childTeam, fallback: null },
];

function between(filter, pattern) {
  return new RegExp(pattern).exec(filter)?.[1];
}

export function accessFixture({ assigned = {} } = {}) {
  const writes = [];
  const reads = [];
  const links = new Map(
    teams.map((team) => [team.teamid, new Set(assigned[team.teamid] ?? [])]),
  );
  const ok = (rows) => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ value: rows }),
  });
  const client = new DataverseClient(
    environment.url,
    { getToken: async () => "fixture-token" },
    {
      get: async (value) => {
        reads.push(value);
        const url = new URL(value);
        const path = url.pathname.split("/api/data/v9.2/")[1];
        const filter = url.searchParams.get("$filter") ?? "";
        if (path === "WhoAmI")
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              OrganizationId: environment.organizationId,
              UserId: "app",
              BusinessUnitId: rootUnit,
            }),
          };
        if (path === "teams") {
          const teamId = between(filter, "^teamid eq ([0-9a-f-]+)$");
          const name = between(filter, "^name eq '(.*)'$");
          return ok(
            teams.filter((team) =>
              teamId === undefined
                ? team.name === name
                : team.teamid === teamId,
            ),
          );
        }
        const association =
          /^teams\(([0-9a-f-]+)\)\/teamroles_association$/.exec(path);
        if (association !== null)
          return ok(
            [...links.get(association[1])].map((roleid) => ({ roleid })),
          );
        if (path === "roles") {
          const name = between(filter, "^name eq '(.*)' and ");
          const unit = between(
            filter,
            "_businessunitid_value eq ([0-9a-f-]+)$",
          );
          return ok(
            roles.filter(
              (role) =>
                role.name === name && role._businessunitid_value === unit,
            ),
          );
        }
        if (path === "businessunits") return ok([{ businessunitid: rootUnit }]);
        if (path === "environmentvariabledefinitions") {
          const definitionId = between(
            filter,
            "^environmentvariabledefinitionid eq ([0-9a-f-]+)$",
          );
          if (definitionId === undefined)
            return ok(
              definitions.map((definition, index) => ({
                environmentvariabledefinitionid: id(`d${index}`),
                schemaname: definition.schema,
                displayname: definition.schema,
                type: definition.type,
                ismanaged: false,
              })),
            );
          return ok([
            {
              defaultvalue:
                definitions[Number(definitionId.slice(-1))].fallback,
            },
          ]);
        }
        if (path === "environmentvariablevalues") {
          const definition = definitions[Number(filter.match(/-0+d(\d)/)[1])];
          return ok(
            definition.value === null ? [] : [{ value: definition.value }],
          );
        }
        throw new Error(`Unmatched fixture request: ${value}`);
      },
      request: async (method, value, _headers, body) => {
        const path = new URL(value).pathname.split("/api/data/v9.2/")[1];
        const association =
          /^teams\(([0-9a-f-]+)\)\/teamroles_association\/\$ref$/.exec(path);
        if (method !== "POST" || association === null)
          throw new Error(`Unmatched fixture write: ${method} ${value}`);
        const roleId = /roles\(([0-9a-f-]+)\)$/.exec(
          JSON.parse(body)["@odata.id"],
        )[1];
        writes.push({ teamId: association[1], roleId });
        links.get(association[1]).add(roleId);
        return { status: 204, headers: {}, body: "" };
      },
    },
    { now: () => 0, wait: async () => {} },
  );
  return { client, writes, reads, links };
}

export const document = (...teams) => ({ accessVersion: 1, teams });
