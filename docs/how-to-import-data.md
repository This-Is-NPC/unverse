# Import a transfer manifest

**The question:** How do I import a reviewed manifest without overwriting an
existing PostgreSQL application schema?

This page requires [a canonical export](how-to-export-data.md).

## Before you start

Add a PostgreSQL reference to the selected environment profile. These names
are placeholders; the actual connection string belongs only in the referenced
environment variable:

```json
{
  "postgres": {
    "connectionStringEnv": "UNVERSE_POSTGRES_URL",
    "schema": "unverse_import"
  }
}
```

This object is the `postgres` field inside a normal Dataverse environment
profile, not a complete configuration. The database role needs CREATE SCHEMA
and ownership of the new namespace. Use a dedicated non-system schema;
`public`, `information_schema`, and `pg_*` are rejected.

## Steps

1. Import with explicit confirmation:

   ```sh
   unverse transfer import --env dev --manifest-file manifest.json --confirm --json
   ```

   Installed-package tests imported the synthetic manifest into disposable
   PostgreSQL and returned `verified: true`, matching row counts, preserved
   identity maps, and a `committed` checkpoint.

2. Inspect `data.differences`, `data.checkpoint`, and `data.limitations`. Creation,
   rows, foreign keys, and the checkpoint commit in one PostgreSQL transaction.
   IDs are preserved. Foreign keys are initially deferred so cycles do not
   require dropping relationships or nullable staging columns.

## What can go wrong

A pre-existing schema without the matching Unverse ownership checkpoint is
never modified. A different manifest fingerprint is rejected. Failed imports
roll back, including newly created tables and the schema. After a lost commit
response, retry the identical immutable manifest: a matching committed
checkpoint triggers verification and a no-op rather than reinsertion.

This is checkpoint-level resume, not per-row streaming resume. An existing
committed dataset that fails verification is not overwritten or repaired.
Inspect the differences instead. There is no automatic network retry for writes.
This command targets PostgreSQL only, not continuous synchronization. A
[separate reviewed data plan](how-to-transfer-dataverse.md) targets Dataverse.

## Next

[Verify the imported data](how-to-verify-transfer.md) without writes.
