export const dependencyEnvironment = {
  name: "dev",
  url: "https://dev.crm.dynamics.com",
  organizationId: "fixture-org",
};
export const dependencyId = (n) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const referenceType = 10089;
export const referenceId = dependencyId(101);
export const referenceRow = {
  connectionreferenceid: referenceId,
  connectionreferencelogicalname: "uv_example_reference",
  connectionreferencedisplayname: "Example connection reference",
  connectorid: "/providers/Microsoft.PowerApps/apis/shared_example",
  connectionid: "synthetic-connection",
  _customconnectorid_value: dependencyId(105),
  statecode: 0,
  ismanaged: false,
};
export const connectorRow = {
  connectorid: dependencyId(105),
  name: "uv_example_connector",
  displayname: "Example custom connector",
  connectorinternalid: "synthetic-custom-api",
  connectortype: 1,
  statecode: 0,
  ismanaged: false,
};
const dependency = (fromType, from, toType, to, dependencytype = 2) => ({
  dependentcomponenttype: fromType,
  dependentcomponentobjectid: dependencyId(from),
  requiredcomponenttype: toType,
  requiredcomponentobjectid: dependencyId(to),
  dependencytype,
});
export const dependencyRows = [
  dependency(29, 102, referenceType, 101),
  dependency(300, 103, 29, 102),
  dependency(29, 104, 29, 102),
  dependency(29, 102, 29, 104),
  dependency(777, 102, 29, 104),
];

export function dependencyTransport(options = {}) {
  const requests = [];
  const rows = options.rows ?? dependencyRows;
  const get = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const path = decodeURIComponent(url.pathname).replace(
      "/api/data/v9.2/",
      "",
    );
    const response = (body) => ({
      status: 200,
      headers: {},
      body: JSON.stringify(body),
    });
    if (path === "WhoAmI")
      return response({
        OrganizationId: "fixture-org",
        UserId: dependencyId(1),
        BusinessUnitId: dependencyId(2),
      });
    const call =
      /^(RetrieveRequiredComponents|RetrieveDependentComponents)\(ObjectId=([^,]+),ComponentType=(\d+)\)$/.exec(
        path,
      );
    let value;
    if (call) {
      if (options.denied === call[1])
        return {
          status: 403,
          headers: {},
          body: '{"error":{"message":"Denied"}}',
        };
      if (options.auth === call[1])
        return {
          status: 401,
          headers: {},
          body: '{"error":{"message":"Unauthorized"}}',
        };
      const required = call[1] === "RetrieveRequiredComponents";
      value = rows.filter((row) =>
        required
          ? row.dependentcomponentobjectid === call[2] &&
            row.dependentcomponenttype === Number(call[3])
          : row.requiredcomponentobjectid === call[2] &&
            row.requiredcomponenttype === Number(call[3]),
      );
      if (options.unrelated) value = [...value, dependency(29, 900, 29, 901)];
      if (options.duplicate) value = [...value, ...value];
    } else if (path === "EntityDefinitions")
      value = [
        {
          LogicalName: "connectionreference",
          ObjectTypeCode: options.referenceType ?? referenceType,
        },
      ];
    else if (path === "connectionreferences") {
      const filter = /connectionreferenceid eq ([a-f\d-]+)/i.exec(
        url.searchParams.get("$filter") ?? "",
      )?.[1];
      value = (options.references ?? [referenceRow]).filter(
        (row) => filter === undefined || row.connectionreferenceid === filter,
      );
    } else if (path === "connectors") value = [connectorRow];
    else if (path === "workflows") {
      const id = /workflowid eq ([a-f\d-]+)/i.exec(
        url.searchParams.get("$filter") ?? "",
      )?.[1];
      value = [102, 104]
        .filter((n) => id === undefined || dependencyId(n) === id)
        .map((n) => ({
          workflowid: dependencyId(n),
          name: n === 102 ? "Example flow" : "Helper flow",
          uniquename: `uv_flow_${n}`,
        }));
    } else if (path === "canvasapps")
      value = [
        {
          canvasappid: dependencyId(103),
          name: "uv_canvas",
          displayname: "Example canvas app",
        },
      ];
    else if (path === "solutions")
      value = [
        {
          solutionid: dependencyId(200),
          uniquename: "ExampleSolution",
          friendlyname: "Example Solution",
        },
      ];
    else if (path === "solutioncomponents") {
      const custom = url.searchParams.get("$filter")?.startsWith("objectid eq");
      value = custom
        ? [{ componenttype: 371, objectid: dependencyId(105) }]
        : (options.memberships ?? [
            { componenttype: referenceType, objectid: referenceId },
            { componenttype: 300, objectid: dependencyId(103) },
          ]);
    } else throw new Error(`Unexpected dependency fixture route: ${path}`);
    return response({ value });
  };
  return { get, requests };
}
