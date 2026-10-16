import assert from "node:assert/strict";
import test from "node:test";
import { createManifest, parseModel } from "@unverse/core";
import { Client } from "pg";
import { withPostgres } from "../../../scripts/lib/postgres.mjs";
import data from "../../core/test/fixtures/data.json" with { type: "json" };
import sourceModel from "../../core/test/fixtures/schema.json" with {
  type: "json",
};
import { PostgresStore } from "../dist/index.js";

const model = parseModel(sourceModel);
const manifest = await createManifest(
  model,
  data,
  {
    name: "dev",
    url: "https://synthetic.crm.dynamics.com",
    organizationId: "fixture",
  },
  { prefix: "uv", solution: "Fixture" },
);

test("PostgreSQL preserves IDs, relationships, decimals, dates, and instants", async () =>
  withPostgres(async (connection) => {
    const store = new PostgresStore(connection, "fixture");
    try {
      const report = await store.import(manifest, true);
      assert.equal(report.verified, true);
      assert.equal(report.checkpoint, "committed");
      const resumed = await store.import(manifest, true);
      assert.equal(resumed.checkpoint, "verified-resume");
      assert.deepEqual(resumed.sourceCounts, { child: 1, parent: 1 });
    } finally {
      await store.close();
    }
  }));

test("PostgreSQL refuses a pre-existing unowned schema", async () =>
  withPostgres(async (connection) => {
    const client = new Client(connection);
    const store = new PostgresStore(connection, "fixture");
    try {
      await client.connect();
      await client.query("CREATE SCHEMA fixture");
      await assert.rejects(
        store.import(manifest, true),
        /ownership checkpoint/,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='fixture'",
          )
        ).rows[0].count,
        "0",
      );
    } finally {
      await store.close();
      await client.end();
    }
  }));

test("PostgreSQL detects changed decimal schema precision", async () =>
  withPostgres(async (connection) => {
    const store = new PostgresStore(connection, "fixture");
    const client = new Client(connection);
    try {
      await store.import(manifest, true);
      await client.connect();
      await client.query(
        "ALTER TABLE fixture.parent ALTER COLUMN amount TYPE numeric(8,3)",
      );
      const report = await store.verify(manifest);
      assert.equal(report.verified, false);
      assert.ok(
        report.differences.some(
          (entry) => entry.kind === "schema" && entry.column === "amount",
        ),
      );
    } finally {
      await store.close();
      await client.end();
    }
  }));

test("PostgreSQL rolls back partial imports before a safe retry", async () =>
  withPostgres(async (connection) => {
    const store = new PostgresStore(connection, "fixture");
    const client = new Client(connection);
    const query = store.client.query.bind(store.client);
    let failed = false;
    store.client.query = async (sql, ...parameters) => {
      if (!failed && sql.startsWith('INSERT INTO "fixture"."parent"')) {
        failed = true;
        throw new Error("Injected provider failure");
      }
      return query(sql, ...parameters);
    };
    try {
      await assert.rejects(
        store.import(manifest, true),
        /Injected provider failure/,
      );
      assert.equal(
        (await store.client.query("SELECT txid_current_if_assigned() AS id"))
          .rows[0].id,
        null,
      );
      await client.connect();
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM information_schema.schemata WHERE schema_name='fixture'",
          )
        ).rows[0].count,
        "0",
      );
      assert.equal((await store.import(manifest, true)).verified, true);
    } finally {
      await store.close();
      await client.end();
    }
  }));

test("PostgreSQL defers cyclic relationship checks until all rows exist", async () =>
  withPostgres(async (connection) => {
    const cyclicModel = parseModel({
      ...model,
      entities: model.entities.map((entity) =>
        entity.name === "parent"
          ? {
              ...entity,
              columns: [
                ...entity.columns,
                {
                  name: "childid",
                  type: "uuid",
                  nullable: false,
                  references: "child",
                },
              ],
            }
          : entity,
      ),
    });
    const cyclicData = structuredClone(data);
    cyclicData.parent[0].childid = cyclicData.child[0].id;
    const cyclicManifest = await createManifest(
      cyclicModel,
      cyclicData,
      manifest.source.environment,
      manifest.source.mapping,
    );
    const store = new PostgresStore(connection, "fixture");
    try {
      await assert.doesNotReject(async () => {
        assert.equal((await store.import(cyclicManifest, true)).verified, true);
      });
    } finally {
      await store.close();
    }
  }));

test("PostgreSQL detects a removed primary key", async () =>
  withPostgres(async (connection) => {
    const oneModel = parseModel({
      modelVersion: 1,
      entities: model.entities.filter((entity) => entity.name === "parent"),
    });
    const oneManifest = await createManifest(
      oneModel,
      { parent: data.parent },
      manifest.source.environment,
      manifest.source.mapping,
    );
    const store = new PostgresStore(connection, "fixture");
    const client = new Client(connection);
    try {
      await store.import(oneManifest, true);
      await client.connect();
      await client.query(
        "ALTER TABLE fixture.parent DROP CONSTRAINT parent_pkey",
      );
      const report = await store.verify(oneManifest);
      assert.equal(report.verified, false);
      assert.ok(
        report.differences.some((entry) => entry.kind === "schema-primary-key"),
      );
    } finally {
      await store.close();
      await client.end();
    }
  }));

test("PostgreSQL preserves multiline text and enforces choice definitions", async () =>
  withPostgres(async (connection) => {
    const extended = parseModel({
      ...model,
      entities: model.entities.map((entity) =>
        entity.name === "parent"
          ? {
              ...entity,
              columns: [
                ...entity.columns,
                {
                  name: "notes",
                  type: "multiline",
                  nullable: true,
                  maxLength: 8000,
                },
                {
                  name: "status",
                  type: "choice",
                  nullable: false,
                  options: [
                    { value: 1, label: "Open" },
                    { value: 2, label: "Closed" },
                  ],
                },
              ],
            }
          : entity,
      ),
    });
    const changed = structuredClone(data);
    changed.parent[0].notes = "Multiline\nExample";
    changed.parent[0].status = 1;
    const selected = await createManifest(
      extended,
      changed,
      manifest.source.environment,
      manifest.source.mapping,
    );
    const store = new PostgresStore(connection, "fixture");
    const client = new Client(connection);
    try {
      const report = await store.import(selected, true);
      assert.equal(report.verified, true);
      await client.connect();
      await assert.rejects(
        client.query("UPDATE fixture.parent SET status=3"),
        /check constraint/,
      );
      await client.query(
        'ALTER TABLE fixture.parent DROP CONSTRAINT "__unverse_choice_status"',
      );
      assert.equal((await store.verify(selected)).verified, false);
    } finally {
      await store.close();
      await client.end();
    }
  }));
