import {
  type Column,
  type IdentityMap,
  parseManifest,
  postgresSchemaName,
  preservedIdentities,
  record,
  SchemaError,
  type SchemaModel,
  type TransferManifest,
  type TransferVerification,
  verifyTransfer,
} from "@unverse/core";
import { Client, type ClientConfig, type QueryResult, types } from "pg";

export interface ImportReport extends TransferVerification {
  readonly target: { readonly provider: "postgres"; readonly schema: string };
  readonly checkpoint: "committed" | "verified-resume" | "read-only";
}

export class PostgresStore {
  private readonly client: Client;
  private connected = false;

  constructor(
    connection: string | ClientConfig,
    readonly schema: string,
  ) {
    postgresSchemaName(schema);
    this.client = new Client({
      ...(typeof connection === "string"
        ? { connectionString: connection }
        : connection),
      connectionTimeoutMillis: 15_000,
      statement_timeout: 60_000,
      types: {
        getTypeParser: (oid, format) =>
          [1082, 1114, 1184, 1700].includes(oid)
            ? (value: string) => value
            : types.getTypeParser(oid, format),
      },
    });
  }

  async import(input: unknown, confirm: boolean): Promise<ImportReport> {
    if (!confirm)
      throw new SchemaError(
        "invalid-input",
        "Transfer import requires explicit confirmation.",
      );
    const manifest = await parseManifest(input);
    await this.connect();
    await this.client.query("BEGIN");
    try {
      await this.client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `unverse:${this.schema}`,
      ]);
      const exists = await this.client.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
        [this.schema],
      );
      if (exists.rowCount !== 0) {
        const checkpoint = await this.readCheckpoint(manifest);
        const report = await this.verify(manifest, checkpoint);
        if (!report.verified)
          throw new SchemaError(
            "invalid-input",
            "Resume verification failed; existing data will not be overwritten.",
          );
        await this.client.query("COMMIT");
        return { ...report, checkpoint: "verified-resume" };
      }
      await this.client.query(`CREATE SCHEMA ${quote(this.schema)}`);
      await this.client.query(
        `CREATE TABLE ${this.table("__unverse_transfer")} (fingerprint text PRIMARY KEY, identities jsonb NOT NULL)`,
      );
      for (const entity of manifest.model.entities) {
        const columns = entity.columns.map(
          (column) =>
            `${quote(column.name)} ${sqlType(column)}${column.name === entity.primaryKey ? " PRIMARY KEY" : column.nullable ? "" : " NOT NULL"}${column.type === "choice" ? ` CONSTRAINT ${quote(`__unverse_choice_${column.name}`)} CHECK (${quote(column.name)} = ANY (ARRAY[${column.options?.map((option) => option.value).join(",")}]))` : ""}`,
        );
        await this.client.query(
          `CREATE TABLE ${this.table(entity.name)} (${columns.join(", ")})`,
        );
      }
      for (const entity of manifest.model.entities)
        for (const column of entity.columns) {
          if (column.references === undefined) continue;
          const target = manifest.model.entities.find(
            (candidate) => candidate.name === column.references,
          );
          if (target === undefined)
            throw new SchemaError(
              "invalid-input",
              "Unknown relationship target.",
            );
          await this.client.query(
            `ALTER TABLE ${this.table(entity.name)} ADD FOREIGN KEY (${quote(column.name)}) REFERENCES ${this.table(target.name)} (${quote(target.primaryKey)}) DEFERRABLE INITIALLY DEFERRED`,
          );
        }
      for (const entity of manifest.model.entities)
        for (const row of manifest.data[entity.name] ?? []) {
          const columns = entity.columns.map((column) => quote(column.name));
          const parameters = columns.map((_, index) => `$${index + 1}`);
          await this.client.query(
            `INSERT INTO ${this.table(entity.name)} (${columns.join(", ")}) VALUES (${parameters.join(", ")})`,
            entity.columns.map((column) => row[column.name]),
          );
        }
      const identities = preservedIdentities(manifest);
      const report = await this.verify(manifest, identities);
      if (!report.verified)
        throw new SchemaError(
          "invalid-input",
          "Imported values failed equivalence verification; transaction rolled back.",
        );
      await this.client.query(
        `INSERT INTO ${this.table("__unverse_transfer")} VALUES ($1, $2::jsonb)`,
        [manifest.fingerprint, JSON.stringify(identities)],
      );
      await this.client.query("COMMIT");
      return { ...report, checkpoint: "committed" };
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }

  async verify(
    input: unknown,
    identities?: IdentityMap,
  ): Promise<ImportReport> {
    const manifest = await parseManifest(input);
    await this.connect();
    const mapping = identities ?? (await this.readCheckpoint(manifest));
    const data: Record<string, readonly Record<string, unknown>[]> = {};
    for (const entity of manifest.model.entities) {
      const rows = await this.client.query(
        `SELECT ${entity.columns.map((column) => quote(column.name)).join(", ")} FROM ${this.table(entity.name)} ORDER BY ${quote(entity.primaryKey)}`,
      );
      data[entity.name] = rows.rows.map((row) =>
        Object.fromEntries(
          entity.columns.map((column) => [
            column.name,
            fromPostgres(column, row[column.name]),
          ]),
        ),
      );
    }
    const report = verifyTransfer(manifest, data, mapping);
    const metadata = await this.metadataDifferences(manifest.model);
    return {
      ...report,
      verified: report.verified && metadata.length === 0,
      differences: [...report.differences, ...metadata],
      target: { provider: "postgres", schema: this.schema },
      checkpoint: "read-only",
    };
  }

  async close(): Promise<void> {
    await this.client.end();
    this.connected = false;
  }

  private async metadataDifferences(
    model: SchemaModel,
  ): Promise<{ kind: string; entity: string; column: string }[]> {
    const differences: { kind: string; entity: string; column: string }[] = [];
    const typeNames = {
      text: "character varying",
      multiline: "character varying",
      choice: "integer",
      boolean: "boolean",
      integer: "integer",
      decimal: "numeric",
      uuid: "uuid",
      date: "date",
      instant: "timestamp with time zone",
    };
    for (const entity of model.entities) {
      const columns = await this.client.query(
        "SELECT column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale, datetime_precision FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
        [this.schema, entity.name],
      );
      const references = await this.client.query(
        "SELECT k.column_name, c.table_schema AS foreign_schema, c.table_name AS foreign_table, c.column_name AS foreign_column FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k USING (constraint_catalog, constraint_schema, constraint_name) JOIN information_schema.constraint_column_usage c USING (constraint_catalog, constraint_schema, constraint_name) WHERE t.table_schema=$1 AND t.table_name=$2 AND t.constraint_type='FOREIGN KEY'",
        [this.schema, entity.name],
      );
      const keys = await this.client.query(
        "SELECT k.column_name FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k USING (constraint_catalog, constraint_schema, constraint_name) WHERE t.table_schema=$1 AND t.table_name=$2 AND t.constraint_type='PRIMARY KEY' ORDER BY k.ordinal_position",
        [this.schema, entity.name],
      );
      const checks = await this.client.query(
        "SELECT c.conname, pg_get_expr(c.conbin,c.conrelid) AS expression FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND c.contype='c' AND c.convalidated",
        [this.schema, entity.name],
      );
      if (
        keys.rows.length !== 1 ||
        keys.rows[0]?.column_name !== entity.primaryKey
      )
        differences.push({
          kind: "schema-primary-key",
          entity: entity.name,
          column: entity.primaryKey,
        });
      for (const column of entity.columns) {
        const observed = columns.rows.find(
          (row) => row.column_name === column.name,
        );
        const wrongDecimal =
          column.type === "decimal" &&
          (observed?.numeric_precision !== column.precision ||
            observed?.numeric_scale !== column.scale);
        const wrongText =
          (column.type === "text" || column.type === "multiline") &&
          observed?.character_maximum_length !== column.maxLength;
        const wrongTime =
          column.type === "instant" && observed?.datetime_precision !== 0;
        const wrongChoice =
          column.type === "choice" &&
          !checks.rows.some(
            (row) =>
              row.conname === `__unverse_choice_${column.name}` &&
              row.expression.replace(/[\s"]/g, "") ===
                `(${column.name}=ANY(ARRAY[${column.options?.map((option) => option.value).join(",")}]))`,
          );
        const target = model.entities.find(
          (candidate) => candidate.name === column.references,
        );
        const wrongReference =
          column.references !== undefined &&
          !references.rows.some(
            (row) =>
              row.column_name === column.name &&
              row.foreign_schema === this.schema &&
              row.foreign_table === column.references &&
              row.foreign_column === target?.primaryKey,
          );
        if (
          observed?.data_type !== typeNames[column.type] ||
          observed?.is_nullable !== (column.nullable ? "YES" : "NO") ||
          wrongDecimal ||
          wrongText ||
          wrongTime ||
          wrongChoice ||
          wrongReference
        )
          differences.push({
            kind: "schema",
            entity: entity.name,
            column: column.name,
          });
      }
    }
    return differences;
  }

  private async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
    await this.client.query("SET TIME ZONE 'UTC'");
  }

  private async readCheckpoint(
    manifest: TransferManifest,
  ): Promise<IdentityMap> {
    let rows: QueryResult;
    try {
      rows = await this.client.query(
        `SELECT fingerprint, identities FROM ${this.table("__unverse_transfer")}`,
      );
    } catch {
      throw new SchemaError(
        "invalid-input",
        "The existing schema has no readable Unverse ownership checkpoint; it will not be modified.",
      );
    }
    if (
      rows.rows.length !== 1 ||
      rows.rows[0].fingerprint !== manifest.fingerprint
    )
      throw new SchemaError(
        "invalid-input",
        "The schema is owned by another transfer manifest; no overwrite is allowed.",
      );
    const identities = record(rows.rows[0].identities);
    for (const group of Object.values(identities)) {
      const values = record(group);
      if (Object.values(values).some((value) => typeof value !== "string"))
        throw new SchemaError(
          "invalid-input",
          "The identity checkpoint is invalid.",
        );
    }
    return identities as IdentityMap;
  }

  private table(name: string): string {
    return `${quote(this.schema)}.${quote(name)}`;
  }
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlType(column: Column): string {
  switch (column.type) {
    case "text":
    case "multiline":
      return `varchar(${column.maxLength})`;
    case "boolean":
      return "boolean";
    case "integer":
    case "choice":
      return "integer";
    case "decimal":
      return `numeric(${column.precision}, ${column.scale})`;
    case "uuid":
      return "uuid";
    case "date":
      return "date";
    case "instant":
      return "timestamp(0) with time zone";
  }
}

function fromPostgres(column: Column, input: unknown): unknown {
  if (input === null) return null;
  if (column.type === "instant" && typeof input === "string")
    return input.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return input;
}
