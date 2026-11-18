# Export modeled data

**The question:** How do I produce a reviewable, integrity-checked manifest
for the portable Dataverse subset?

This page requires [an inspected, satisfied schema](how-to-inspect-schema.md).
It is not a general Dataverse backup.

## Before you start

Review the logical model and publisher mapping. The export includes all
modeled rows under those tables, not arbitrary system or business tables.
The application user needs read permissions for every selected field and row.
Keep exported manifests private: they contain IDs and record values.

## Steps

1. Export into a local file. The mapping, model, and output paths below are
   placeholders. `mapping.json` holds `{ "prefix": "tx", "solution": "TransferFixture" }`:

   ```sh
   unverse pg export --env dev --mapping-file mapping.json --model-file schema.json --format json > manifest.json
   ```

   The installed synthetic fixture exported one parent, one related child,
   preserved UUIDs, a fixed-scale decimal string, a date, and a UTC instant.
   Export first checks that metadata satisfies the model with no pending or
   blocked schema changes.

2. Review `data.model`, `data.source`, `data.policy`, and the row counts in
   `data.data`. `data.fingerprint` binds the canonical model, source identity,
   policy, and values. Do not edit the manifest after review.

## Tenant-scoped user references

A column may point at a Microsoft Entra user (`aaduser`) with
`"scope": "tenant"`, because that ID is the same in every environment of the
tenant. The model, with placeholder names, declares:

```json
{ "name": "assignee", "type": "uuid", "nullable": true,
  "externalReference": { "table": "aaduser", "primaryKey": "aaduserid", "scope": "tenant" } }
```

The manifest keeps the UUID as is. The export does not check that the user
exists in any environment, and PostgreSQL stores a `uuid` column without a
foreign key. Other tables are refused. A model that declares `systemuser`:

```sh
unverse pg export --env dev --mapping-file mapping.json --model-file bad.json --format json
```

fails with (run with the built CLI and placeholder credentials; the check
happens before any request):

```text
"error":{"code":"unsupported","message":"Only aaduser can be declared tenant-scoped; other external IDs are environment-local."}
```

A tenant-scoped export or import lists this among the report limitations
(produced by the offline fixture checks, not a live export):

```text
Tenant-scoped references (parent.owner) keep their UUIDs; their existence in the target tenant is not verified, and PostgreSQL stores them as uuid without a foreign key.
System lookups (owner, created by, modified by, business unit) are not modeled columns and are not copied.
```

## What can go wrong

The export is held in memory and is intended for a bounded modeled dataset.
It is not a transactional snapshot across Dataverse pages. Missing required
values, broken relationships, unknown types, incomplete pages, or lossy
decimal/time conversions fail instead of yielding a valid-looking manifest.
Decimal values are fixed-scale strings. Instants require explicit UTC second
resolution; fractional seconds are rejected, not rounded away. A live fixture
detected a temporal mismatch when fractional input was assumed portable.

No workflows, plugins, policies, auditing, files, or unmodeled fields
are exported. Local single-select choices and bounded multiline text are
supported; global/multiselect choices and environment-local external
reference datasets are not. A tenant-scoped user reference is supported (see
below). Owner, created by, modified by, and business unit are not modeled and
not exported.
PostgreSQL transfer does not recreate application behaviour.

## Next

[Import the manifest](how-to-import-data.md) into a dedicated PostgreSQL schema.
For a different Dataverse organization, use a reviewed
[field-policy transfer plan](how-to-transfer-dataverse.md).
