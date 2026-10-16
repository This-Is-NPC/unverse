import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import sourceData from "../../../core/test/fixtures/data.json" with {
  type: "json",
};
import model from "../../../core/test/fixtures/schema.json" with {
  type: "json",
};
import { dependencyTransport } from "../../../dataverse/test/fixtures/dependency-http.mjs";

const dependencyHttp = dependencyTransport();

const instant = "2026-10-17T00:00:00.000Z";
const data = process.env.FIXTURE_DATA_FILE
  ? JSON.parse(readFileSync(process.env.FIXTURE_DATA_FILE, "utf8"))
  : sourceData;
for (const transport of [http, https]) {
  transport.request = transport.get = () => {
    throw new Error("Offline fixtures forbid native HTTP connections.");
  };
}
syncBuiltinESMExports();
const SystemDate = Date;
globalThis.Date = class extends SystemDate {
  constructor(...args) {
    super(...(args.length ? args : [instant]));
  }
  static now() {
    return SystemDate.parse(instant);
  }
};

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@azure/identity")
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent('export class ClientSecretCredential { async getToken() { return { token: "fixture-token" }; } }')}`,
      };
    return next(specifier, context);
  },
});

const id = (suffix) => `00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;
const role = {
  roleid: id("2"),
  name: "Reader",
  _businessunitid_value: id("4"),
};
const routes = {
  solutions: {
    value: [
      {
        solutionid: id("11"),
        uniquename: "CommunityFixture",
        friendlyname: "Community Fixture",
        version: "1.0.0.0",
        ismanaged: false,
      },
    ],
  },
  solutioncomponents: {
    value: [
      {
        solutioncomponentid: id("12"),
        objectid: id("13"),
        componenttype: 80,
        rootcomponentbehavior: 0,
      },
    ],
  },
  canvasapps: {
    value: [
      {
        canvasappid: id("14"),
        name: "fixture_canvas",
        displayname: "Synthetic Canvas App",
      },
    ],
  },
  appmodules: {
    value: [
      {
        appmoduleid: id("15"),
        name: "Synthetic Model App",
        uniquename: "fixture_model",
        statecode: 0,
      },
    ],
  },
  workflows: {
    value: [
      {
        workflowid: id("16"),
        name: "Synthetic Flow",
        uniquename: "fixture_flow",
        statecode: 1,
      },
    ],
  },
  environmentvariabledefinitions: {
    value: [
      {
        environmentvariabledefinitionid: id("17"),
        schemaname: "fixture_endpoint",
        displayname: "Fixture Endpoint",
        type: 100000000,
        defaultvalue: "synthetic-not-a-real-value",
      },
    ],
  },
  environmentvariablevalues: { value: [] },
  WhoAmI: { OrganizationId: id("5"), UserId: id("1"), BusinessUnitId: id("4") },
  systemusers: {
    value: [
      {
        systemuserid: id("1"),
        fullname: "Synthetic User",
        internalemailaddress: "synthetic@example.invalid",
        domainname: "synthetic@example.invalid",
        isdisabled: false,
        _businessunitid_value: id("4"),
      },
    ],
  },
  [`systemusers(${id("1")})/systemuserroles_association`]: { value: [role] },
  [`systemusers(${id("1")})/teammembership_association`]: {
    value: [{ teamid: id("3"), name: "Synthetic Team" }],
  },
  [`teams(${id("3")})/teamroles_association`]: { value: [role] },
  roles: { value: [role] },
  EntityDefinitions: {
    value: [
      {
        LogicalName: "account",
        EntitySetName: "accounts",
        PrimaryIdAttribute: "accountid",
        DisplayName: { UserLocalizedLabel: { Label: "Account" } },
        IsIntersect: false,
      },
    ],
  },
  accounts: { value: [{ accountid: id("6"), name: "Synthetic Account" }] },
};

const metadataExtras = {
  text: { AttributeType: "String", MaxLength: 100 },
  uuid: { AttributeType: "Uniqueidentifier" },
  integer: {
    AttributeType: "Integer",
    MinValue: -2147483648,
    MaxValue: 2147483647,
  },
  boolean: { AttributeType: "Boolean" },
  decimal: {
    AttributeType: "Decimal",
    Precision: 2,
    MinValue: -999999.99,
    MaxValue: 999999.99,
  },
  date: {
    AttributeType: "DateTime",
    Format: "DateOnly",
    DateTimeBehavior: { Value: "DateOnly" },
  },
  instant: {
    AttributeType: "DateTime",
    Format: "DateAndTime",
    DateTimeBehavior: { Value: "UserLocal" },
  },
};
for (const entity of model.entities) {
  const physical = `tx_${entity.name}`;
  const columnName = (column) =>
    column.name === entity.primaryKey ? `${physical}id` : `tx_${column.name}`;
  routes.EntityDefinitions.value.push({
    LogicalName: physical,
    EntitySetName: `${physical}s`,
    MetadataId: `metadata-${entity.name}`,
    PrimaryIdAttribute: `${physical}id`,
    PrimaryNameAttribute: `tx_${entity.primaryName}`,
    IsIntersect: false,
  });
  routes[`EntityDefinitions(LogicalName='${physical}')/Attributes`] = {
    value: entity.columns.map((column) => ({
      LogicalName: columnName(column),
      ...metadataExtras[column.type],
      RequiredLevel: {
        Value: column.nullable ? "None" : "ApplicationRequired",
      },
      ...(column.references === undefined
        ? {}
        : { AttributeType: "Lookup", Targets: [`tx_${column.references}`] }),
    })),
  };
  routes[`${physical}s`] = {
    value: data[entity.name].map((row) =>
      Object.fromEntries(
        entity.columns.map((column) => [
          column.references === undefined
            ? columnName(column)
            : `_${columnName(column)}_value`,
          column.type === "decimal"
            ? Number(row[column.name])
            : row[column.name],
        ]),
      ),
    ),
  };
}

globalThis.fetch = async (input, options) => {
  assert.equal(
    options?.method ?? "GET",
    "GET",
    "Installed picture fixtures are read-only.",
  );
  assert.equal(options?.headers?.Authorization, "Bearer fixture-token");
  const url = new URL(input);
  assert.ok(
    [
      "https://synthetic.crm.dynamics.com",
      "https://synthetic-test.crm.dynamics.com",
    ].includes(url.origin),
  );
  const route = url.pathname.replace("/api/data/v9.2/", "");
  const dependencyRoute = decodeURIComponent(route);
  const dependencyFilter = url.searchParams.get("$filter") ?? "";
  if (
    ["connectors", "connectionreferences"].includes(dependencyRoute) ||
    dependencyRoute.startsWith("RetrieveRequiredComponents(") ||
    dependencyRoute.startsWith("RetrieveDependentComponents(") ||
    (dependencyRoute === "EntityDefinitions" &&
      dependencyFilter === "LogicalName eq 'connectionreference'") ||
    (dependencyRoute === "solutioncomponents" &&
      dependencyFilter.startsWith("objectid eq")) ||
    (dependencyRoute === "workflows" &&
      dependencyFilter.startsWith("workflowid eq")) ||
    (dependencyRoute === "canvasapps" &&
      dependencyFilter.startsWith("canvasappid eq"))
  ) {
    const response = await dependencyHttp.get(input);
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  assert.ok(Object.hasOwn(routes, route), `Unknown fixture route: ${route}`);
  const filter = url.searchParams.get("$filter");
  const name =
    filter === null
      ? undefined
      : /^LogicalName eq '([^']+)'$/.exec(filter)?.[1];
  const body =
    route === "EntityDefinitions" && name !== undefined
      ? {
          value: routes.EntityDefinitions.value.filter(
            (row) => row.LogicalName === name,
          ),
        }
      : routes[route];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
