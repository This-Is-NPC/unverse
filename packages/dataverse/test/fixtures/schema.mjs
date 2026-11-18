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
  const clock = {
    now: () => time,
    wait: async (milliseconds) => {
      time += milliseconds;
    },
  };
  const hide = (object) => hidden.set(object, lag);
  const indexing = new Map();
  const listed = (object) => (hidden.get(object) ?? 0) === 0;
  const age = (object) => {
    const remaining = hidden.get(object) ?? 0;
    if (remaining > 0) hidden.set(object, remaining - 1);
  };
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
