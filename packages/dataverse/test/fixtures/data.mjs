import assert from "node:assert/strict";
import { parseModel, planSchema } from "@unverse/core";
import sourceModel from "../../../core/test/fixtures/schema.json" with {
  type: "json",
};
import { applySchema, inspectSchema } from "../../dist/index.js";
import { environment, mapping, schemaFixture } from "./schema.mjs";

export async function dataFixture(input = sourceModel) {
  const fixture = schemaFixture();
  const model = parseModel(input);
  const get = fixture.client.transport.get;
  const request = fixture.client.transport.request;
  const rows = new Map();
  const batches = [];
  let fail = false;
  const response = (value) => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ value }),
  });
  fixture.client.transport.get = async (input, headers) => {
    const url = new URL(input);
    const path = decodeURIComponent(url.pathname).replace(
      "/api/data/v9.2/",
      "",
    );
    if (path === "EntityDefinitions") {
      const filter = /^LogicalName eq '([^']+)'$/.exec(
        url.searchParams.get("$filter") ?? "",
      )?.[1];
      return response(
        [...fixture.entities.values()]
          .map(({ metadata }) => ({
            ...metadata,
            EntitySetName: `${metadata.LogicalName}s`,
            IsIntersect: false,
          }))
          .filter((row) => filter === undefined || row.LogicalName === filter),
      );
    }
    if (path.startsWith("RelationshipDefinitions/")) {
      const filter = url.searchParams.get("$filter");
      const entity = /ReferencingEntity eq '([^']+)'/.exec(filter)?.[1];
      const column = /ReferencingAttribute eq '([^']+)'/.exec(filter)?.[1];
      return response(
        fixture.entities
          .get(entity)
          .columns.filter((row) => row.LogicalName === column)
          .map((row) => ({
            ReferencedEntity: row.Targets[0],
            ReferencingEntityNavigationPropertyName: `${row.LogicalName}_nav`,
          })),
      );
    }
    if ([...fixture.entities.keys()].some((name) => `${name}s` === path))
      return response(rows.get(path) ?? []);
    return get(input, headers);
  };
  fixture.client.transport.request = async (method, input, headers, body) => {
    if (!input.endsWith("/$batch"))
      return request(method, input, headers, body);
    batches.push(body);
    assert.match(headers["Content-Type"], /^multipart\/mixed;boundary=batch_/);
    const next = structuredClone(rows);
    const parts = body.split(/(?=PATCH https:\/\/)/).slice(1);
    const statuses = [];
    for (const part of parts) {
      const match =
        /^PATCH https:\/\/[^\r\n]+\/api\/data\/v9\.2\/([^()]+)\(([^)]+)\)/.exec(
          part,
        );
      assert.ok(match, part);
      const [, set, id] = match;
      const value = JSON.parse(part.split("\r\n\r\n")[1].split("\r\n")[0]);
      const values = next.get(set) ?? [];
      const table = fixture.entities.get(set.slice(0, -1));
      const pk = table.metadata.PrimaryIdAttribute;
      const existing = values.find((row) => row[pk] === id);
      if (part.includes("If-None-Match: *")) {
        if (existing) {
          statuses.push(412);
          continue;
        }
        values.push({ ...value, [pk]: id });
      } else {
        assert.ok(existing);
        for (const [name, binding] of Object.entries(value)) {
          const column = name.replace("_nav@odata.bind", "");
          existing[`_${column}_value`] = /\(([^)]+)\)/.exec(binding)[1];
        }
      }
      next.set(set, values);
      statuses.push(fail ? 400 : 204);
    }
    if (statuses.every((status) => status < 300)) {
      rows.clear();
      for (const [key, value] of next) rows.set(key, value);
    }
    return {
      status: 200,
      headers: {},
      body: statuses
        .map((status) => `HTTP/1.1 ${status} Result\r\n\r\n`)
        .join(""),
    };
  };
  const plan = await planSchema(
    model,
    mapping,
    environment,
    await inspectSchema(fixture.client, mapping, model),
  );
  const after = await applySchema(fixture.client, plan, environment, true);
  assert.deepEqual(after.blocked, []);
  fixture.writes.length = 0;
  return {
    ...fixture,
    model,
    mapping,
    environment,
    rows,
    batches,
    failBatch: () => {
      fail = true;
    },
  };
}
