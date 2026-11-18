import { DataverseClient } from "../../dist/index.js";

export const id = (n) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

export const rows = {
  EntityDefinitions: [
    {
      LogicalName: "account",
      EntitySetName: "accounts",
      PrimaryIdAttribute: "accountid",
      DisplayName: { UserLocalizedLabel: { Label: "Account" } },
      IsIntersect: false,
    },
    {
      LogicalName: "uv_unlabelled",
      EntitySetName: "uv_unlabelleds",
      PrimaryIdAttribute: "uv_unlabelledid",
      DisplayName: { UserLocalizedLabel: null },
      IsIntersect: false,
    },
  ],
  canvasapps: [
    {
      canvasappid: id(1),
      name: "uv_classic",
      displayname: "Classic app",
      canvasapptype: 0,
      ismanaged: false,
      _ownerid_value: id(90),
    },
    {
      canvasappid: id(2),
      name: "uv_code",
      displayname: "Code app",
      canvasapptype: 4,
      ismanaged: true,
      _ownerid_value: id(91),
    },
    { canvasappid: id(3), name: "uv_bare", displayname: "Bare app" },
  ],
  appmodules: [
    {
      appmoduleid: id(4),
      name: "Model app",
      uniquename: "uv_model",
      statecode: 0,
    },
  ],
  workflows: [
    {
      workflowid: id(5),
      name: "Managed flow",
      uniquename: "uv_flow",
      statecode: 1,
      ismanaged: true,
      _ownerid_value: id(90),
    },
    { workflowid: id(6), name: "Bare flow", uniquename: null, statecode: 0 },
  ],
  roles: [
    { roleid: id(7), name: "Maker", ismanaged: false },
    { roleid: id(8), name: "Bare role" },
  ],
  connectionreferences: [
    {
      connectionreferenceid: id(9),
      connectionreferencelogicalname: "uv_ref",
      connectionreferencedisplayname: "Reference",
      connectorid: "/providers/Microsoft.PowerApps/apis/shared_example",
      connectionid: null,
      _customconnectorid_value: null,
      statecode: 0,
      ismanaged: false,
    },
  ],
  environmentvariabledefinitions: [
    {
      environmentvariabledefinitionid: id(10),
      schemaname: "uv_variable",
      displayname: "Variable",
      type: 100000000,
      ismanaged: true,
    },
    {
      environmentvariabledefinitionid: id(11),
      schemaname: "uv_bare_variable",
      displayname: "Bare variable",
      type: 100000000,
    },
  ],
  solutions: [
    {
      solutionid: id(12),
      uniquename: "uv_solution",
      friendlyname: "Solution",
      version: "1.0",
      ismanaged: false,
    },
  ],
  connectors: [
    {
      connectorid: id(13),
      name: "uv_connector",
      displayname: "Connector",
      connectorinternalid: null,
      connectortype: 1,
      statecode: 0,
      ismanaged: true,
    },
  ],
};

export function artifactFixture(overrides = {}) {
  const requests = [];
  const client = new DataverseClient(
    "https://dev.crm.dynamics.com",
    { getToken: async () => "fixture-token" },
    {
      get: async (value) => {
        requests.push(value);
        const url = new URL(value);
        const path = url.pathname.split("/").at(-1);
        const body =
          path === "WhoAmI"
            ? { OrganizationId: "org", UserId: "app", BusinessUnitId: "unit" }
            : { value: { ...rows, ...overrides }[path] };
        if (body.value === undefined && path !== "WhoAmI")
          throw new Error(`Unexpected fixture request: ${value}`);
        return { status: 200, headers: {}, body: JSON.stringify(body) };
      },
    },
    { now: () => 0, wait: async () => {} },
  );
  return { client, requests };
}
