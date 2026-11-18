import {
  type Column,
  canonical,
  type DataverseMapping,
  type Entity,
  isSolutionComponentOperation,
  type Key,
  type ObservedColumn,
  type ObservedKey,
  ownedColumnsOutsideModel,
  parseMapping,
  parseModel,
  physicalColumn,
  physicalEntity,
  physicalKey,
  planSchema,
  record,
  type SchemaEnvironment,
  type SchemaModel,
  type SchemaPlan,
  type SchemaSnapshot,
} from "@unverse/core";
import { type DataverseClient, DataverseError } from "./client.js";
import { endpoint, guid, identifier, literal, text } from "./odata.js";
import {
  createSolutionComponents,
  inspectSolutionComponents,
} from "./solution-components.js";

export async function inspectSchema(
  client: DataverseClient,
  mapping: DataverseMapping,
  model?: SchemaModel,
): Promise<SchemaSnapshot> {
  const definitions = await client.collect(
    endpoint("EntityDefinitions", {
      $select:
        "LogicalName,EntitySetName,MetadataId,PrimaryIdAttribute,PrimaryNameAttribute",
    }),
  );
  const entities = [];
  for (const entity of definitions.rows) {
    const name = text(entity, "LogicalName");
    if (!name.startsWith(`${mapping.prefix}_`)) continue;
    const columns = await client.collect(
      `EntityDefinitions(LogicalName='${safeName(name)}')/Attributes`,
    );
    const picklists = columns.rows.some(
      (column) => column.AttributeType === "Picklist",
    )
      ? await client.collect(
          `EntityDefinitions(LogicalName='${safeName(name)}')/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`,
        )
      : { rows: [] };
    const externalKeys = new Map<string, string>();
    for (const column of columns.rows) {
      if (
        column.AttributeType !== "Lookup" ||
        !Array.isArray(column.Targets) ||
        column.Targets.length !== 1 ||
        typeof column.Targets[0] !== "string" ||
        column.Targets[0].startsWith(`${mapping.prefix}_`)
      )
        continue;
      const target = await client.collect(
        endpoint("EntityDefinitions", {
          $select: "LogicalName,PrimaryIdAttribute",
          $filter: `LogicalName eq ${literal(column.Targets[0])}`,
        }),
      );
      if (target.rows.length === 1)
        externalKeys.set(
          column.Targets[0],
          text(target.rows[0] ?? {}, "PrimaryIdAttribute"),
        );
    }
    const keys = await client.collect(
      `EntityDefinitions(LogicalName='${safeName(name)}')/Keys`,
    );
    const modeled = model?.entities.find(
      (candidate) => physicalEntity(mapping, candidate) === name,
    );
    const observedColumns = columns.rows
      .filter(
        (column) =>
          column.IsLogical !== true &&
          (column.AttributeOf === undefined || column.AttributeOf === null),
      )
      .map((column) =>
        normalizeColumn(
          {
            ...column,
            ...picklists.rows.find(
              (picklist) => picklist.LogicalName === column.LogicalName,
            ),
          },
          mapping,
          externalKeys,
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const owned =
      modeled === undefined
        ? []
        : ownedColumnsOutsideModel(mapping, modeled, observedColumns);
    for (const column of owned)
      observedColumns[observedColumns.indexOf(column)] = {
        ...column,
        data: await probeData(
          client,
          text(entity, "EntitySetName"),
          text(entity, "PrimaryIdAttribute"),
          column,
        ),
      };
    entities.push({
      name,
      metadataId: text(entity, "MetadataId"),
      primaryKey: text(entity, "PrimaryIdAttribute"),
      primaryName: text(entity, "PrimaryNameAttribute"),
      columns: observedColumns,
      keys: keys.rows
        .map(normalizeKey)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  const externalTargets: { table: string; primaryKey: string }[] = [];
  for (const entity of model?.entities ?? [])
    for (const column of entity.columns) {
      if (
        column.externalReference === undefined ||
        externalTargets.some(
          (target) => target.table === column.externalReference?.table,
        )
      )
        continue;
      const target = await client.collect(
        endpoint("EntityDefinitions", {
          $select: "LogicalName,PrimaryIdAttribute",
          $filter: `LogicalName eq ${literal(column.externalReference.table)}`,
        }),
      );
      if (target.rows.length === 1)
        externalTargets.push({
          table: text(target.rows[0] ?? {}, "LogicalName"),
          primaryKey: text(target.rows[0] ?? {}, "PrimaryIdAttribute"),
        });
    }
  const solutionComponents = await inspectSolutionComponents(client, mapping);
  return {
    ...(solutionComponents === undefined ? {} : { solutionComponents }),
    entities: entities.sort((a, b) => a.name.localeCompare(b.name)),
    ...(model?.entities.some((entity) =>
      entity.columns.some((column) => column.externalReference !== undefined),
    )
      ? {
          externalTargets: externalTargets.sort((a, b) =>
            a.table.localeCompare(b.table),
          ),
        }
      : {}),
  };
}

export async function applySchema(
  client: DataverseClient,
  input: unknown,
  environment: SchemaEnvironment,
  confirm: boolean,
): Promise<SchemaPlan> {
  if (!confirm)
    throw new DataverseError(
      "invalid-input",
      "schema apply requires explicit --confirm.",
    );
  const value = record(input);
  if (
    value.planVersion !== 1 ||
    value.provider !== "dataverse" ||
    canonical(value.environment) !== canonical(environment)
  )
    throw new DataverseError(
      "invalid-input",
      "Plan is invalid or bound to another environment.",
    );
  const model = parseModel(value.model);
  await assertEnvironment(client, environment);
  const mapping = parseMapping(value.mapping);
  const snapshot = await inspectSchema(client, mapping, model);
  const expected = await planSchema(model, mapping, environment, snapshot);
  if (canonical(expected) !== canonical(input))
    throw new DataverseError(
      "invalid-input",
      "Plan is stale or has been modified; create and review a new plan.",
    );
  if (expected.blocked.length !== 0)
    throw new DataverseError(
      "unsupported",
      "The plan contains blocked changes; no writes were issued.",
    );
  const solutions = await client.collect(
    endpoint("solutions", {
      $select: "_publisherid_value",
      $filter: `uniquename eq ${literal(mapping.solution)}`,
    }),
  );
  if (solutions.rows.length !== 1)
    throw new DataverseError(
      "invalid-input",
      "The mapped solution does not resolve uniquely.",
    );
  const publisherId = guid(text(solutions.rows[0] ?? {}, "_publisherid_value"));
  const publishers = await client.collect(
    endpoint("publishers", {
      $select: "customizationprefix",
      $filter: `publisherid eq ${publisherId}`,
    }),
  );
  if (
    publishers.rows.length !== 1 ||
    publishers.rows[0]?.customizationprefix !== mapping.prefix
  )
    throw new DataverseError(
      "invalid-input",
      "The solution publisher prefix does not match the reviewed mapping.",
    );
  const headers = { "MSCRM.SolutionUniqueName": mapping.solution };
  const relationships: { entity: Entity; column: Column }[] = [];
  const keys: { entity: Entity; key: Key }[] = [];
  for (const operation of expected.operations) {
    if (isSolutionComponentOperation(operation)) continue;
    const entity = model.entities.find(
      (candidate) => candidate.name === operation.entity,
    );
    if (entity === undefined)
      throw new DataverseError("invalid-input", "Plan entity is missing.");
    if (operation.kind === "create-entity") {
      const attributes = entity.columns
        .filter(
          (column) =>
            column.name !== entity.primaryKey &&
            column.references === undefined &&
            column.externalReference === undefined,
        )
        .map((column) => attributeMetadata(entity, column, mapping));
      await client.write(
        "POST",
        "EntityDefinitions",
        {
          "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
          SchemaName: physicalEntity(mapping, entity),
          DisplayName: label(entity.name),
          DisplayCollectionName: label(`${entity.name} records`),
          Description: label(
            "Managed by an explicitly reviewed Unverse schema plan.",
          ),
          OwnershipType: "OrganizationOwned",
          IsActivity: false,
          HasActivities: false,
          HasNotes: false,
          Attributes: attributes,
        },
        headers,
      );
      await visible(
        client,
        physicalEntity(mapping, entity),
        attributes.map((attribute) => String(attribute.SchemaName)),
      );
      for (const column of entity.columns)
        if (
          column.references !== undefined ||
          column.externalReference !== undefined
        )
          relationships.push({ entity, column });
    } else if (operation.kind === "add-option") {
      const column = entity.columns.find(
        (candidate) => candidate.name === operation.column,
      );
      if (column === undefined)
        throw new DataverseError("invalid-input", "Plan column is missing.");
      await client.write(
        "POST",
        "InsertOptionValue",
        {
          EntityLogicalName: physicalEntity(mapping, entity),
          AttributeLogicalName: physicalColumn(mapping, entity, column),
          Value: operation.value,
          Label: label(operation.label),
          SolutionUniqueName: mapping.solution,
        },
        headers,
      );
    } else if (operation.kind === "create-key") {
      const key = entity.keys?.find(
        (candidate) => candidate.name === operation.key,
      );
      if (key === undefined)
        throw new DataverseError("invalid-input", "Plan key is missing.");
      keys.push({ entity, key });
    } else {
      const column = entity.columns.find(
        (candidate) => candidate.name === operation.column,
      );
      if (column === undefined)
        throw new DataverseError("invalid-input", "Plan column is missing.");
      if (
        column.references !== undefined ||
        column.externalReference !== undefined
      )
        relationships.push({ entity, column });
      else {
        const metadata = attributeMetadata(entity, column, mapping);
        await client.write(
          "POST",
          `EntityDefinitions(LogicalName='${physicalEntity(mapping, entity)}')/Attributes`,
          metadata,
          headers,
        );
        await visible(client, physicalEntity(mapping, entity), [
          String(metadata.SchemaName),
        ]);
      }
    }
  }
  for (const { entity, column } of relationships) {
    const target = model.entities.find(
      (candidate) => candidate.name === column.references,
    );
    if (target === undefined && column.externalReference === undefined)
      throw new DataverseError(
        "invalid-input",
        "Relationship target is missing.",
      );
    await client.write(
      "POST",
      "RelationshipDefinitions",
      {
        "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
        SchemaName: `${mapping.prefix}_${entity.name}_${column.name}`,
        ReferencedEntity:
          column.externalReference?.table ??
          physicalEntity(mapping, target as Entity),
        ReferencingEntity: physicalEntity(mapping, entity),
        Lookup: {
          "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
          SchemaName: physicalColumn(mapping, entity, column),
          DisplayName: label(column.name),
          RequiredLevel: required(column),
        },
        AssociatedMenuConfiguration: { Behavior: "DoNotDisplay" },
        CascadeConfiguration: {
          Assign: "NoCascade",
          Delete: "Restrict",
          Merge: "NoCascade",
          Reparent: "NoCascade",
          Share: "NoCascade",
          Unshare: "NoCascade",
        },
      },
      headers,
    );
    await visible(client, physicalEntity(mapping, entity), [
      physicalColumn(mapping, entity, column),
    ]);
  }
  for (const { entity, key } of keys)
    await createKey(client, mapping, entity, key, headers);
  await createSolutionComponents(
    client,
    mapping,
    expected.operations.filter(isSolutionComponentOperation),
    headers,
  );
  return planSchema(
    model,
    mapping,
    environment,
    await inspectSchema(client, mapping, model),
  );
}

async function createKey(
  client: DataverseClient,
  mapping: DataverseMapping,
  entity: Entity,
  key: Key,
  headers: Readonly<Record<string, string>>,
): Promise<void> {
  const keys = `EntityDefinitions(LogicalName='${physicalEntity(mapping, entity)}')/Keys`;
  const schemaName = physicalKey(mapping, key);
  await client.write(
    "POST",
    keys,
    {
      "@odata.type": "Microsoft.Dynamics.CRM.EntityKeyMetadata",
      SchemaName: schemaName,
      DisplayName: label(key.name),
      KeyAttributes: key.columns.map((name) =>
        physicalColumn(
          mapping,
          entity,
          entity.columns.find((column) => column.name === name) as Column,
        ),
      ),
    },
    headers,
  );
  const listing = async () =>
    (await client.collect(keys)).rows.find(
      (row) => row.SchemaName === schemaName,
    );
  await awaitVisible(client, schemaName, listing);
  await client.until(
    async () => {
      const status = (await listing())?.EntityKeyIndexStatus;
      return status === "Active" || status === "Failed" ? status : undefined;
    },
    indexDeadline,
    visibilityInterval,
  );
}

const visibilityDeadline = 120_000;
const indexDeadline = 300_000;
const visibilityInterval = 2_000;

async function visible(
  client: DataverseClient,
  entity: string,
  attributes: readonly string[],
): Promise<void> {
  await awaitVisible(client, entity, async () => {
    try {
      const present = await client.collect(
        endpoint(
          `EntityDefinitions(LogicalName='${safeName(entity)}')/Attributes`,
          { $select: "LogicalName" },
        ),
      );
      return attributes.every((name) =>
        present.rows.some((row) => row.LogicalName === name),
      )
        ? true
        : undefined;
    } catch (error) {
      if (error instanceof DataverseError && error.httpStatus === 404)
        return undefined;
      throw error;
    }
  });
}

async function awaitVisible(
  client: DataverseClient,
  subject: string,
  probe: () => Promise<unknown>,
): Promise<void> {
  const shown = await client.until(
    probe,
    visibilityDeadline,
    visibilityInterval,
  );
  if (shown === undefined)
    throw new DataverseError(
      "service",
      `Created metadata for ${subject} is not visible after ${visibilityDeadline / 1000} seconds; inspect and create a fresh plan before retrying.`,
    );
}

export async function assertEnvironment(
  client: DataverseClient,
  environment: SchemaEnvironment,
): Promise<void> {
  const identity = await client.whoAmI();
  if (
    client.url !== environment.url ||
    identity.organizationId !== environment.organizationId
  )
    throw new DataverseError(
      "invalid-input",
      "The supplied environment does not match the authenticated client.",
    );
}

const filterableTypes = [
  "String",
  "Integer",
  "BigInt",
  "Decimal",
  "Double",
  "Money",
  "Boolean",
  "DateTime",
  "Picklist",
  "Uniqueidentifier",
];

async function probeData(
  client: DataverseClient,
  entitySet: string,
  primaryKey: string,
  column: ObservedColumn,
): Promise<NonNullable<ObservedColumn["data"]>> {
  if (!filterableTypes.includes(column.providerType))
    return {
      holdsData: "unknown",
      evidence: `A ${column.providerType} column cannot be filtered for values, so it was not read.`,
    };
  const read = `${entitySet}?$select=${primaryKey}&$filter=${column.name} ne null&$top=1`;
  try {
    const rows = await client.collect(
      endpoint(entitySet, {
        $select: identifier(primaryKey),
        $filter: `${identifier(column.name)} ne null`,
        $top: "1",
      }),
      1,
    );
    return {
      holdsData: rows.rows.length !== 0,
      evidence: `Read ${read} returned ${rows.rows.length === 0 ? "no rows" : "a row"} for this identity.`,
    };
  } catch (error) {
    if (!(error instanceof DataverseError) || error.code === "authentication")
      throw error;
    return {
      holdsData: "unknown",
      evidence: `Read ${read} failed (${error.code}): ${error.message}`,
    };
  }
}

function normalizeKey(row: Record<string, unknown>): ObservedKey {
  const columns = row.KeyAttributes;
  if (
    !Array.isArray(columns) ||
    columns.some((column) => typeof column !== "string")
  )
    throw new DataverseError(
      "service",
      "Dataverse key metadata is missing KeyAttributes.",
    );
  return {
    name: text(row, "SchemaName"),
    columns: [...columns].sort(),
    indexStatus: text(row, "EntityKeyIndexStatus"),
  };
}

function normalizeColumn(
  row: Record<string, unknown>,
  mapping: DataverseMapping,
  externalKeys: ReadonlyMap<string, string>,
): ObservedColumn {
  const providerType = text(row, "AttributeType");
  const level = row.RequiredLevel;
  if (
    typeof level !== "object" ||
    level === null ||
    !["None", "Recommended", "ApplicationRequired", "SystemRequired"].includes(
      String((level as Record<string, unknown>).Value),
    )
  )
    return { name: text(row, "LogicalName"), providerType, definition: null };
  const nullable =
    typeof level === "object" && level !== null
      ? (level as Record<string, unknown>).Value === "None"
      : true;
  const base = { nullable };
  let definition: ObservedColumn["definition"] = null;
  switch (providerType) {
    case "String":
      if (typeof row.MaxLength === "number")
        definition = { ...base, type: "text", maxLength: row.MaxLength };
      break;
    case "Memo":
      if (typeof row.MaxLength === "number")
        definition = { ...base, type: "multiline", maxLength: row.MaxLength };
      break;
    case "Picklist": {
      const optionSet = row.OptionSet;
      if (
        typeof optionSet === "object" &&
        optionSet !== null &&
        (optionSet as Record<string, unknown>).IsGlobal === false
      ) {
        const options = (optionSet as Record<string, unknown>).Options;
        if (Array.isArray(options) && options.length) {
          const normalized = options.map((option) => {
            if (typeof option !== "object" || option === null) return null;
            const label = option.Label?.LocalizedLabels?.find(
              (entry: Record<string, unknown>) => entry.LanguageCode === 1033,
            )?.Label;
            return typeof option.Value === "number" && typeof label === "string"
              ? { value: option.Value, label }
              : null;
          });
          if (normalized.every((option) => option !== null))
            definition = {
              ...base,
              type: "choice",
              options: normalized.sort((a, b) => a.value - b.value),
            };
        }
      }
      break;
    }
    case "Boolean":
      definition = { ...base, type: "boolean" };
      break;
    case "Integer":
      if (row.MinValue === -2147483648 && row.MaxValue === 2147483647)
        definition = { ...base, type: "integer" };
      break;
    case "Uniqueidentifier":
      definition = { ...base, type: "uuid" };
      break;
    case "Lookup": {
      if (
        Array.isArray(row.Targets) &&
        row.Targets.length === 1 &&
        typeof row.Targets[0] === "string" &&
        row.Targets[0].startsWith(`${mapping.prefix}_`)
      )
        definition = {
          ...base,
          type: "uuid",
          references: row.Targets[0].slice(mapping.prefix.length + 1),
        };
      else if (
        Array.isArray(row.Targets) &&
        row.Targets.length === 1 &&
        typeof row.Targets[0] === "string" &&
        externalKeys.has(row.Targets[0])
      )
        definition = {
          ...base,
          type: "uuid",
          externalReference: {
            table: row.Targets[0],
            primaryKey: externalKeys.get(row.Targets[0]) as string,
          },
        };
      break;
    }
    case "Decimal": {
      if (
        typeof row.Precision === "number" &&
        typeof row.MaxValue === "number" &&
        row.MinValue === -row.MaxValue
      )
        definition = {
          ...base,
          type: "decimal",
          precision:
            (row.MaxValue < 1 ? 0 : String(Math.floor(row.MaxValue)).length) +
            row.Precision,
          scale: row.Precision,
        };
      break;
    }
    case "DateTime": {
      const behavior = row.DateTimeBehavior;
      const value =
        typeof behavior === "object" && behavior !== null
          ? (behavior as Record<string, unknown>).Value
          : undefined;
      if (value === "DateOnly" && row.Format === "DateOnly")
        definition = { ...base, type: "date" };
      else if (value === "UserLocal" && row.Format === "DateAndTime")
        definition = {
          ...base,
          type: "instant",
          semantics: "utc",
          resolution: "second",
        };
    }
  }
  return { name: text(row, "LogicalName"), providerType, definition };
}

function attributeMetadata(
  entity: Entity,
  column: Column,
  mapping: DataverseMapping,
): Record<string, unknown> {
  const base = {
    SchemaName: physicalColumn(mapping, entity, column),
    DisplayName: label(column.name),
    RequiredLevel: required(column),
  };
  switch (column.type) {
    case "multiline":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata",
        MaxLength: column.maxLength,
        Format: "TextArea",
      };
    case "choice":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
        OptionSet: {
          "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata",
          IsGlobal: false,
          OptionSetType: "Picklist",
          Options: column.options?.map((option) => ({
            Value: option.value,
            Label: label(option.label),
          })),
        },
      };
    case "text":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        MaxLength: column.maxLength,
        FormatName: { Value: "Text" },
        IsPrimaryName: column.name === entity.primaryName,
      };
    case "boolean":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata",
        DefaultValue: false,
        OptionSet: {
          TrueOption: { Value: 1, Label: label("True") },
          FalseOption: { Value: 0, Label: label("False") },
        },
      };
    case "integer":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata",
        Format: "None",
        MinValue: -2147483648,
        MaxValue: 2147483647,
      };
    case "decimal": {
      const maximum = Number(
        `${"9".repeat((column.precision ?? 0) - (column.scale ?? 0)) || "0"}.${"9".repeat(column.scale ?? 0) || "0"}`,
      );
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata",
        Precision: column.scale,
        MinValue: -maximum,
        MaxValue: maximum,
      };
    }
    case "date":
    case "instant":
      return {
        ...base,
        "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata",
        Format: column.type === "date" ? "DateOnly" : "DateAndTime",
        DateTimeBehavior: {
          Value: column.type === "date" ? "DateOnly" : "UserLocal",
        },
      };
    default:
      throw new DataverseError(
        "unsupported",
        "Unsupported standalone attribute mapping.",
      );
  }
}

function label(value: string): Record<string, unknown> {
  return { LocalizedLabels: [{ Label: value, LanguageCode: 1033 }] };
}

function required(column: Column): { readonly Value: string } {
  return { Value: column.nullable ? "None" : "ApplicationRequired" };
}

function safeName(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw new DataverseError(
      "service",
      "Metadata returned an unsafe logical name.",
    );
  return value;
}
