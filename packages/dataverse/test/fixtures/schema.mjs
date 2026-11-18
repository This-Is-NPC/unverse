import { parseModel } from "@unverse/core";
import { DataverseClient } from "../../dist/index.js";

export const mapping = { prefix: "uv", solution: "UnverseFixture" };
export const environment = {
  name: "dev",
  url: "https://dev.crm.dynamics.com",
  organizationId: "organization",
};
export const model = parseModel({
  modelVersion: 1,
  entities: [
    {
      name: "parent",
      primaryKey: "id",
      primaryName: "name",
      columns: [
        { name: "id", type: "uuid", nullable: false },
        { name: "name", type: "text", nullable: false, maxLength: 100 },
        {
          name: "amount",
          type: "decimal",
          nullable: true,
          precision: 8,
          scale: 2,
        },
        { name: "day", type: "date", nullable: true },
        {
          name: "created",
          type: "instant",
          nullable: true,
          semantics: "utc",
          resolution: "second",
        },
        { name: "enabled", type: "boolean", nullable: true },
        { name: "count", type: "integer", nullable: true },
      ],
    },
  ],
});

export function schemaFixture({
  lag = 0,
  keyLag = lag,
  goneLag = 0,
  indexLag = 0,
  rows = {},
  denied = [],
} = {}) {
  const entities = new Map();
  const writes = [];
  const early = [];
  const probes = [];
  const hidden = new Map();
  let time = 0;
  let keyCount = 0;
  const clock = {
    now: () => time,
    wait: async (milliseconds) => {
      time += milliseconds;
    },
  };
  const hide = (object) => hidden.set(object, lag);
  const indexing = new Map();
  const doomed = new Map();
  const listed = (object) =>
    (hidden.get(object) ?? 0) === 0 && doomed.get(object) !== 0;
  const age = (object) => {
    const remaining = hidden.get(object) ?? 0;
    if (remaining > 0) hidden.set(object, remaining - 1);
    if ((doomed.get(object) ?? 0) > 0)
      doomed.set(object, doomed.get(object) - 1);
  };
  const remove = (object) => doomed.set(object, goneLag);
  const response = (body) => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  });
  const transport = {
    get: async (input) => {
      const url = new URL(input);
      const path = decodeURIComponent(url.pathname).replace(
        "/api/data/v9.2/",
        "",
      );
      if (path === "WhoAmI")
        return response({
          OrganizationId: "organization",
          UserId: "app",
          BusinessUnitId: "unit",
        });
      if (path === "EntityDefinitions")
        return response({
          value: [...entities.values()]
            .filter(listed)
            .map((entity) => entity.metadata),
        });
      if (path.endsWith("/Attributes")) {
        const name = /LogicalName='([^']+)'/.exec(path)?.[1];
        const entity = entities.get(name);
        const shown = entity !== undefined && listed(entity);
        const visibleColumns = (entity?.columns ?? []).filter(listed);
        for (const object of [entity, ...(entity?.columns ?? [])])
          if (object !== undefined) age(object);
        if (!shown)
          return {
            status: 404,
            headers: {},
            body: JSON.stringify({ error: { message: "Not found." } }),
          };
        return response({ value: visibleColumns });
      }
      if (
        path.endsWith(
          "/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        )
      ) {
        const name = /LogicalName='([^']+)'/.exec(path)?.[1];
        return response({
          value: (entities.get(name)?.columns ?? []).filter(
            (column) => column.AttributeType === "Picklist",
          ),
        });
      }
      const set = [...entities.values()].find(
        (entity) => entity.metadata.EntitySetName === path,
      );
      if (set !== undefined) {
        const filter = /^(\w+) ne null$/.exec(
          url.searchParams.get("$filter") ?? "",
        )?.[1];
        probes.push(url.search);
        if (denied.includes(filter))
          return {
            status: 403,
            headers: {},
            body: JSON.stringify({ error: { message: "Access denied." } }),
          };
        return response({
          value: (rows[set.metadata.LogicalName] ?? [])
            .filter((row) => row[filter] !== undefined && row[filter] !== null)
            .slice(0, Number(url.searchParams.get("$top")))
            .map(() => ({ [url.searchParams.get("$select")]: "row" })),
        });
      }
      if (path.endsWith("/ManyToOneRelationships")) {
        const entity = entities.get(/LogicalName='([^']+)'/.exec(path)?.[1]);
        const shown = (entity?.relationships ?? []).filter(listed);
        for (const relationship of entity?.relationships ?? [])
          age(relationship);
        return response({ value: shown });
      }
      if (path.endsWith("/Keys")) {
        const name = /LogicalName='([^']+)'/.exec(path)?.[1];
        const entity = entities.get(name);
        const keys = (entity?.keys ?? []).filter(listed);
        const rows = keys.map((key) => ({
          ...key,
          EntityKeyIndexStatus:
            (indexing.get(key) ?? 0) > 0 ? "Pending" : "Active",
        }));
        for (const key of entity?.keys ?? []) {
          age(key);
          if (listed(key)) indexing.set(key, (indexing.get(key) ?? 0) - 1);
        }
        return response({ value: rows });
      }
      if (path === "solutions")
        return response({
          value: [
            { _publisherid_value: "00000000-0000-0000-0000-000000000001" },
          ],
        });
      if (path === "publishers")
        return response({ value: [{ customizationprefix: mapping.prefix }] });
      throw new Error(`Unknown schema fixture read: ${path}`);
    },
    request: async (method, input, headers, json) => {
      const path = decodeURIComponent(new URL(input).pathname).replace(
        "/api/data/v9.2/",
        "",
      );
      const body = JSON.parse(json ?? "{}");
      writes.push({ method, path, body, headers });
      if (method === "DELETE") {
        const owner = entities.get(/LogicalName='([^']+)'/.exec(path)?.[1]);
        const named = /\((?:LogicalName|SchemaName)='([^']+)'\)$/.exec(
          path,
        )?.[1];
        const identifier = /\/Keys\(([^)]+)\)$/.exec(path)?.[1];
        if (identifier !== undefined)
          remove(owner.keys.find((key) => key.MetadataId === identifier));
        else if (path.startsWith("RelationshipDefinitions")) {
          for (const entity of entities.values()) {
            const relationship = entity.relationships.find(
              (value) => value.SchemaName === named,
            );
            if (relationship === undefined) continue;
            remove(relationship);
            remove(
              entity.columns.find(
                (column) =>
                  column.LogicalName === relationship.ReferencingAttribute,
              ),
            );
          }
        } else
          remove(owner.columns.find((column) => column.LogicalName === named));
        return { status: 204, headers: {}, body: "" };
      }
      const target =
        path === "RelationshipDefinitions"
          ? [body.ReferencedEntity, body.ReferencingEntity]
          : path === "InsertOptionValue"
            ? [body.EntityLogicalName]
            : [/LogicalName='([^']+)'/.exec(path)?.[1]];
      for (const name of target)
        if (
          name !== undefined &&
          entities.has(name) &&
          !listed(entities.get(name))
        )
          early.push({ path, name });
      if (path === "EntityDefinitions") {
        const primary = body.Attributes.find(
          (attribute) => attribute.IsPrimaryName,
        );
        const entity = {
          metadata: {
            LogicalName: body.SchemaName,
            EntitySetName: `${body.SchemaName}s`,
            MetadataId: `metadata-${entities.size}`,
            PrimaryIdAttribute: `${body.SchemaName}id`,
            PrimaryNameAttribute: primary.SchemaName,
          },
          columns: [
            {
              LogicalName: `${body.SchemaName}id`,
              AttributeType: "Uniqueidentifier",
              RequiredLevel: { Value: "SystemRequired" },
            },
            ...body.Attributes.map(attribute),
          ],
          keys: [],
          relationships: [],
        };
        entities.set(body.SchemaName, entity);
        hide(entity);
        for (const column of entity.columns) hide(column);
      } else if (path === "InsertOptionValue") {
        const column = entities
          .get(body.EntityLogicalName)
          .columns.find(
            (value) => value.LogicalName === body.AttributeLogicalName,
          );
        column.OptionSet.Options.push({ Value: body.Value, Label: body.Label });
      } else if (path.endsWith("/Keys")) {
        const key = {
          SchemaName: body.SchemaName,
          KeyAttributes: body.KeyAttributes,
          MetadataId: `00000000-0000-0000-0000-${String(++keyCount).padStart(12, "0")}`,
        };
        entities.get(/LogicalName='([^']+)'/.exec(path)?.[1]).keys.push(key);
        hidden.set(key, keyLag);
        indexing.set(key, indexLag);
      } else if (path === "RelationshipDefinitions") {
        const column = {
          LogicalName: body.Lookup.SchemaName,
          AttributeType: "Lookup",
          RequiredLevel: body.Lookup.RequiredLevel,
          Targets: [body.ReferencedEntity],
        };
        entities.get(body.ReferencingEntity).columns.push(column);
        hide(column);
        entities.get(body.ReferencingEntity).relationships.push({
          SchemaName: body.SchemaName,
          ReferencingAttribute: body.Lookup.SchemaName,
          ReferencedEntity: body.ReferencedEntity,
        });
      } else {
        const name = /LogicalName='([^']+)'/.exec(path)?.[1];
        const column = attribute(body);
        entities.get(name).columns.push(column);
        hide(column);
      }
      return { status: 204, headers: {}, body: "" };
    },
  };
  const client = new DataverseClient(
    environment.url,
    { getToken: async () => "fixture-token" },
    transport,
    clock,
  );
  return { client, entities, writes, early, clock, probes };
}

function attribute(body) {
  const type = body["@odata.type"]
    .split(".")
    .at(-1)
    .replace("AttributeMetadata", "");
  return { ...body, LogicalName: body.SchemaName, AttributeType: type };
}

export function solutionComponentFixture() {
  const state = schemaFixture();
  const definitions = new Map();
  const references = new Map();
  const reads = [];
  const { get, request } = state.client.transport;
  const filtered = (rows, field, url) =>
    rows.filter(
      (row) =>
        `${field} eq '${row[field]}'` ===
        new URL(url).searchParams.get("$filter"),
    );
  state.client.transport.get = async (url, headers) => {
    const path = decodeURIComponent(new URL(url).pathname).replace(
      "/api/data/v9.2/",
      "",
    );
    if (
      path === "environmentvariabledefinitions" ||
      path === "connectionreferences"
    ) {
      reads.push(url);
      const rows = path === "connectionreferences" ? references : definitions;
      const field =
        path === "connectionreferences"
          ? "connectionreferencelogicalname"
          : "schemaname";
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          value: filtered([...rows.values()], field, url),
        }),
      };
    }
    return get(url, headers);
  };
  state.client.transport.request = async (method, url, headers, json) => {
    const path = decodeURIComponent(new URL(url).pathname).replace(
      "/api/data/v9.2/",
      "",
    );
    if (
      path === "environmentvariabledefinitions" ||
      path === "connectionreferences"
    ) {
      const body = JSON.parse(json);
      state.writes.push({ method, path, body, headers });
      (path === "connectionreferences" ? references : definitions).set(
        body.schemaname ?? body.connectionreferencelogicalname,
        body,
      );
      return { status: 204, headers: {}, body: "" };
    }
    return request(method, url, headers, json);
  };
  return { ...state, definitions, references, reads };
}

const accesses = [
  "Create",
  "Read",
  "Write",
  "Delete",
  "Append",
  "AppendTo",
  "Assign",
  "Share",
];
const rootUnit = "00000000-0000-0000-0000-00000000000a";
const childUnit = "00000000-0000-0000-0000-00000000000b";
const identifier = (number) =>
  `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`;

export function securityRoleFixture({
  privilegeLag = 0,
  known = [],
  options,
} = {}) {
  const state = schemaFixture(options);
  const units = [
    { businessunitid: rootUnit, _parentbusinessunitid_value: null },
    { businessunitid: childUnit, _parentbusinessunitid_value: rootUnit },
  ];
  const roles = [];
  const privileges = new Map();
  const grants = new Map();
  const hiddenPrivileges = new Map();
  const reads = [];
  let counter = 100;
  const addPrivilege = (name, lag = 0) => {
    const id = identifier(counter++);
    privileges.set(id, name);
    hiddenPrivileges.set(id, lag);
    return id;
  };
  for (const name of known) addPrivilege(name);
  const { get, request } = state.client.transport;
  const respond = (value) => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ value }),
  });
  const pathOf = (url) =>
    decodeURIComponent(new URL(url).pathname).replace("/api/data/v9.2/", "");
  state.client.transport.get = async (url, headers) => {
    const path = pathOf(url);
    const filter = new URL(url).searchParams.get("$filter") ?? "";
    if (path === "businessunits") {
      reads.push(url);
      return respond(
        units.filter((unit) => unit._parentbusinessunitid_value === null),
      );
    }
    if (path === "roles") {
      reads.push(url);
      const name = /name eq '((?:[^']|'')*)'/
        .exec(filter)?.[1]
        ?.replaceAll("''", "'");
      const unit = /_businessunitid_value eq ([\da-f-]+)/.exec(filter)?.[1];
      return respond(
        roles.filter(
          (role) =>
            role.name === name &&
            (unit === undefined || role._businessunitid_value === unit),
        ),
      );
    }
    if (path === "privileges") {
      reads.push(url);
      const names = [...filter.matchAll(/name eq '([^']+)'/g)].map(
        (match) => match[1],
      );
      const rows = [...privileges]
        .filter(([, name]) => names.includes(name))
        .map(([privilegeid, name]) => ({ privilegeid, name }));
      const visible = rows.filter(
        ({ privilegeid }) => (hiddenPrivileges.get(privilegeid) ?? 0) === 0,
      );
      for (const { privilegeid } of rows) {
        const remaining = hiddenPrivileges.get(privilegeid) ?? 0;
        if (remaining > 0) hiddenPrivileges.set(privilegeid, remaining - 1);
      }
      return respond(visible);
    }
    if (path === "roleprivilegescollection") {
      reads.push(url);
      const role = /roleid eq ([\da-f-]+)/.exec(filter)?.[1];
      return respond(
        [...(grants.get(role) ?? [])].map(([privilegeid, mask]) => ({
          privilegeid,
          privilegedepthmask: mask,
        })),
      );
    }
    return get(url, headers);
  };
  state.client.transport.request = async (method, url, headers, json) => {
    const path = pathOf(url);
    if (path === "roles") {
      const body = JSON.parse(json);
      state.writes.push({ method, path, body, headers });
      roles.push({
        roleid: identifier(counter++),
        name: body.name,
        _businessunitid_value: /\(([\da-f-]+)\)/.exec(
          body["businessunitid@odata.bind"],
        )?.[1],
      });
      return { status: 204, headers: {}, body: "" };
    }
    const added =
      /^roles\(([\da-f-]+)\)\/Microsoft\.Dynamics\.CRM\.(\w+)$/.exec(path);
    if (added !== null) {
      const body = JSON.parse(json);
      state.writes.push({ method, path, body, headers });
      if (added[2] === "AddPrivilegesRole") {
        const granted = grants.get(added[1]) ?? new Map();
        grants.set(added[1], granted);
        for (const privilege of body.Privileges)
          granted.set(
            privilege.PrivilegeId,
            1 << ["Basic", "Local", "Deep", "Global"].indexOf(privilege.Depth),
          );
      }
      return { status: 204, headers: {}, body: "" };
    }
    const response = await request(method, url, headers, json);
    if (path === "EntityDefinitions") {
      const table = JSON.parse(json).SchemaName;
      for (const access of accesses)
        addPrivilege(`prv${access}${table}`, privilegeLag);
    }
    return response;
  };
  return {
    ...state,
    roles,
    grants,
    privileges,
    reads,
    rootUnit,
    childUnit,
    addPrivilege,
    addRole: (name, unit = rootUnit) => {
      const roleid = identifier(counter++);
      roles.push({ roleid, name, _businessunitid_value: unit });
      return roleid;
    },
    grant: (roleid, name, depth) => {
      const id = [...privileges].find(([, value]) => value === name)?.[0];
      const granted = grants.get(roleid) ?? new Map();
      grants.set(roleid, granted);
      granted.set(id, 1 << ["basic", "local", "deep", "global"].indexOf(depth));
    },
  };
}
