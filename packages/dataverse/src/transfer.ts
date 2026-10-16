import {
  createManifest,
  type Dataset,
  type DataverseMapping,
  physicalColumn,
  planSchema,
  type SchemaEnvironment,
  type SchemaModel,
  type TransferManifest,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { query } from "./query.js";
import { assertEnvironment, inspectSchema } from "./schema.js";

export async function exportTransfer(
  client: DataverseClient,
  model: SchemaModel,
  mapping: DataverseMapping,
  environment: SchemaEnvironment,
): Promise<TransferManifest> {
  await assertEnvironment(client, environment);
  const compatibility = await planSchema(
    model,
    mapping,
    environment,
    await inspectSchema(client, mapping, model),
  );
  if (compatibility.operations.length || compatibility.blocked.length)
    throw new DataverseError(
      "unsupported",
      "Export requires an already satisfied compatible schema; review the schema plan.",
    );
  const data: Record<string, readonly Record<string, unknown>[]> = {};
  for (const entity of model.entities) {
    const select = entity.columns.map((column) =>
      column.references === undefined
        ? physicalColumn(mapping, entity, column)
        : `_${physicalColumn(mapping, entity, column)}_value`,
    );
    const result = await query(client, {
      table: `${mapping.prefix}_${entity.name}`,
      select,
      orderBy: `${mapping.prefix}_${entity.name}id asc`,
    });
    if (!result.complete)
      throw new DataverseError("service", "Export did not complete all pages.");
    data[entity.name] = result.rows.map((row) =>
      Object.fromEntries(
        entity.columns.map((column, index) => {
          let value = row[select[index] ?? ""] ?? null;
          if (column.type === "decimal" && typeof value === "number") {
            const decimal = value.toFixed(column.scale);
            if (Number(decimal) !== value)
              throw new DataverseError(
                "service",
                "The source decimal cannot be represented without loss.",
              );
            value = decimal;
          }
          if (
            column.type === "date" &&
            typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/.test(value)
          )
            value = value.slice(0, 10);
          return [column.name, value];
        }),
      ),
    );
  }
  return createManifest(model, data as Dataset, environment, mapping);
}
