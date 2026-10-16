import {
  type Collection,
  type DataverseClient,
  DataverseError,
} from "./client.js";
import { matches } from "./discovery.js";
import { endpoint, identifier, literal, nullableText, text } from "./odata.js";

export interface Table {
  readonly logicalName: string;
  readonly entitySet: string | null;
  readonly primaryKey: string | null;
  readonly displayName: string | null;
  readonly intersect: boolean;
}

const tableColumns =
  "LogicalName,EntitySetName,PrimaryIdAttribute,DisplayName,IsIntersect";

export async function tables(
  client: DataverseClient,
  search?: string,
): Promise<readonly Table[]> {
  const parameters: Record<string, string> = { $select: tableColumns };
  const result = await client.collect(
    endpoint("EntityDefinitions", parameters),
  );
  const definitions = result.rows.map(tableFromRow);
  return search === undefined
    ? definitions
    : definitions.filter((table) =>
        matches(search, table.logicalName, table.displayName, table.entitySet),
      );
}

export interface QueryOptions {
  readonly table: string;
  readonly select: readonly string[];
  readonly filter?: string;
  readonly orderBy?: string;
  readonly limit?: number;
}

export async function query(
  client: DataverseClient,
  options: QueryOptions,
): Promise<Collection> {
  identifier(options.table);
  if (options.select.length === 0)
    throw new DataverseError(
      "invalid-input",
      "At least one selected column is required.",
    );
  const parameters: Record<string, string> = {
    $select: options.select.map(identifier).join(","),
  };
  if (options.filter !== undefined) parameters.$filter = options.filter;
  if (options.orderBy !== undefined) {
    if (
      !options.orderBy
        .split(",")
        .every((value) =>
          /^[a-z_][a-z\d_]*(?: (?:asc|desc))?$/i.test(value.trim()),
        )
    )
      throw new DataverseError(
        "invalid-input",
        "Ordering must contain column names and optional asc or desc.",
      );
    parameters.$orderby = options.orderBy;
  }
  if (
    options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) || options.limit < 1)
  )
    throw new DataverseError(
      "invalid-input",
      "The row limit must be a positive safe integer.",
    );
  const metadata = await client.collect(
    endpoint("EntityDefinitions", {
      $select: tableColumns,
      $filter: `LogicalName eq ${literal(options.table)}`,
    }),
  );
  if (metadata.rows.length !== 1)
    throw new DataverseError(
      "invalid-input",
      "Expected exactly one table with the selected logical name.",
    );
  const table = tableFromRow(metadata.rows[0] ?? {});
  if (table.entitySet === null)
    throw new DataverseError(
      "unsupported",
      "The table does not expose an entity set.",
    );
  return client.collect(
    endpoint(identifier(table.entitySet), parameters),
    options.limit,
  );
}

function tableFromRow(row: Record<string, unknown>): Table {
  if (typeof row.IsIntersect !== "boolean")
    throw new DataverseError(
      "service",
      "Table metadata is missing IsIntersect.",
    );
  let displayName: string | null = null;
  const display = row.DisplayName;
  if (typeof display === "object" && display !== null) {
    const label = (display as Record<string, unknown>).UserLocalizedLabel;
    if (typeof label === "object" && label !== null)
      displayName = nullableText(label as Record<string, unknown>, "Label");
  }
  return {
    logicalName: text(row, "LogicalName"),
    entitySet: nullableText(row, "EntitySetName"),
    primaryKey: nullableText(row, "PrimaryIdAttribute"),
    displayName,
    intersect: row.IsIntersect,
  };
}
