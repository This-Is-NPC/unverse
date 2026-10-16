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

export function schemaFixture() {
  const entities = new Map();
  const writes = [];
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
          value: [...entities.values()].map((entity) => entity.metadata),
        });
      if (path.endsWith("/Attributes")) {
        const name = /LogicalName='([^']+)'/.exec(path)?.[1];
        return response({ value: entities.get(name)?.columns ?? [] });
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
    request: async (method, input, _headers, json) => {
      const path = decodeURIComponent(new URL(input).pathname).replace(
        "/api/data/v9.2/",
        "",
      );
      const body = JSON.parse(json ?? "{}");
      writes.push({ method, path, body });
      if (path === "EntityDefinitions") {
        const primary = body.Attributes.find(
          (attribute) => attribute.IsPrimaryName,
        );
        entities.set(body.SchemaName, {
          metadata: {
            LogicalName: body.SchemaName,
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
        });
      } else if (path === "RelationshipDefinitions") {
        entities.get(body.ReferencingEntity).columns.push({
          LogicalName: body.Lookup.SchemaName,
          AttributeType: "Lookup",
          RequiredLevel: body.Lookup.RequiredLevel,
          Targets: [body.ReferencedEntity],
        });
      } else {
        const name = /LogicalName='([^']+)'/.exec(path)?.[1];
        entities.get(name).columns.push(attribute(body));
      }
      return { status: 204, headers: {}, body: "" };
    },
  };
  const client = new DataverseClient(
    environment.url,
    { getToken: async () => "fixture-token" },
    transport,
    { now: () => 0, wait: async () => {} },
  );
  return { client, entities, writes };
}

function attribute(body) {
  const type = body["@odata.type"]
    .split(".")
    .at(-1)
    .replace("AttributeMetadata", "");
  return { ...body, LogicalName: body.SchemaName, AttributeType: type };
}
